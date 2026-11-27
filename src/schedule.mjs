// 档期 + 订单：查空位、下订单、改约、取消
import { loadAll, saveAll } from "./store.mjs";

const TZ_OFFSET = "+08:00";
const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const ACTIVE = new Set(["pending", "confirmed", "rescheduled"]);
const STATUS_CN = {
  pending: "待店主确认",
  confirmed: "已确认预约",
  rescheduled: "改约",
  cancelled: "客户取消",
  done: "已完成",
};

async function load() {
  return await loadAll();
}
async function save(data) {
  await saveAll(data);
}
function toDate(s) {
  return new Date(`${s}T12:00:00${TZ_OFFSET}`);
}
function todayStr() {
  const sh = new Date(Date.now() + 8 * 3600 * 1000);
  return sh.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function overlap(a1, a2, b1, b2) {
  return toMin(a1) < toMin(b2) && toMin(b1) < toMin(a2);
}
function subtract(start, end, busy) {
  let segs = [[toMin(start), toMin(end)]];
  for (const b of busy) {
    const bs = toMin(b.start);
    const be = toMin(b.end);
    const next = [];
    for (const [s, e] of segs) {
      if (be <= s || bs >= e) next.push([s, e]);
      else {
        if (s < bs) next.push([s, bs]);
        if (be < e) next.push([be, e]);
      }
    }
    segs = next;
  }
  return segs.map(([s, e]) => [fmtMin(s), fmtMin(e)]);
}

export async function checkSlots(dateStr) {
  const data = await load();
  const today = todayStr();
  const maxDay = addDays(today, data.rules.max_days_ahead);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: `日期格式不对：${dateStr}` };
  if (dateStr < today) return { closed: true, date: dateStr, reason: "这天已经过去了" };
  if (dateStr > maxDay) return { closed: true, date: dateStr, reason: `只能查 ${data.rules.max_days_ahead} 天内的档期` };

  const weekday = toDate(dateStr).getDay();
  let ranges = data.weekly[String(weekday)] ?? [];
  let note = "";
  const ex = data.exceptions[dateStr];
  if (ex) {
    if (ex.closed) return { date: dateStr, weekday: WEEK_CN[weekday], closed: true, reason: ex.note || "这天不接单", available: [] };
    if (ex.ranges) {
      ranges = ex.ranges;
      note = ex.note || "";
    }
  }

  const busy = (data.orders || []).filter((o) => o.date === dateStr && ACTIVE.has(o.status));
  const noticeH = data.rules.min_notice_hours ?? 12;
  const earliest = new Date(Date.now() + noticeH * 3600 * 1000);
  const available = [];
  for (const [start, end] of ranges) {
    if (new Date(`${dateStr}T${start}:00${TZ_OFFSET}`) < earliest) continue;
    for (const [s, e] of subtract(start, end, busy)) {
      if (toMin(e) - toMin(s) >= 60) available.push({ start: s, end: e });
    }
  }

  return {
    date: dateStr,
    weekday: WEEK_CN[weekday],
    weekdayText: `${dateStr} ${WEEK_CN[weekday]}`,
    closed: available.length === 0,
    note,
    available,
    freeText: available.map((a) => `${a.start}–${a.end}`).join("，") || "这天没有空位了",
  };
}

export async function upcoming(days = 7) {
  const today = todayStr();
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const r = await checkSlots(d);
    if (!r.closed && r.available?.length) out.push({ date: d, weekday: r.weekday, weekdayText: r.weekdayText, free: r.freeText });
  }
  return out;
}

function nextId(data) {
  const n = (data.orders || []).length + 1;
  return "O" + String(n).padStart(3, "0");
}

export async function bookSlot({ date, start, name, contact, style, hours, price, shape, note }) {
  const data = await load();
  const today = todayStr();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "日期格式不对" };
  if (date < today) return { error: "不能约过去的时间" };

  const noticeH = data.rules.min_notice_hours ?? 12;
  const minStart = new Date(Date.now() + noticeH * 3600 * 1000);
  if (new Date(`${date}T${start || "10:00"}:00${TZ_OFFSET}`) < minStart) {
    return { error: `需要提前至少 ${noticeH} 小时约（至少提前一天）` };
  }

  const info = await checkSlots(date);
  if (info.closed) return { error: info.reason || "这天不接单" };

  const dur = Number(hours) || data.rules.slot_hours || 2.5;
  const startMin = toMin(start);
  const endMin = startMin + Math.round(dur * 60);
  const end = fmtMin(endMin);

  const hit = (data.orders || []).find((o) => o.date === date && ACTIVE.has(o.status) && overlap(start, end, o.start, o.end));
  if (hit) {
    if (contact && hit.contact === contact && hit.start === start) {
      return { ok: true, already: true, orderId: hit.id, summary: `已经登记过了：${date} ${hit.start}–${hit.end}，${hit.name}，${STATUS_CN[hit.status]}` };
    }
    const left = await checkSlots(date);
    return { error: `${date} ${hit.start}–${hit.end} 已经约出去了`, available: left.available, freeText: left.freeText };
  }

  const maxPerDay = data.rules.max_per_day ?? 2;
  const dayCount = (data.orders || []).filter((o) => o.date === date && ACTIVE.has(o.status)).length;
  if (dayCount >= maxPerDay) return { error: `${date} 已经约满 ${maxPerDay} 个了，换一天吧` };

  const entry = {
    id: nextId(data),
    date,
    start,
    end,
    name: name || "未留名",
    contact: contact || "",
    style: style || "",
    price: price ?? null,
    shape: shape || "",
    hours: dur,
    note: note || "",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.orders.push(entry);
  await save(data);

  return {
    ok: true,
    orderId: entry.id,
    status: STATUS_CN.pending,
    summary: `已登记：${date}（${WEEK_CN[toDate(date).getDay()]}）${start}–${end}，${entry.name}，${entry.style || "款式待定"}`,
    remind: "状态是「待店主确认」，店主核对档期后会再联系客人确认",
  };
}

/** 按订单号或联系方式找订单 */
export async function findOrders({ orderId, contact, name } = {}) {
  const data = await load();
  return (data.orders || []).filter((o) => {
    if (orderId && o.id === orderId) return true;
    if (contact && o.contact === contact) return true;
    if (name && o.name === name) return true;
    return false;
  });
}

export async function updateOrder({ orderId, contact, action, newDate, newStart, note }) {
  const data = await load();
  const order = (data.orders || []).find(
    (o) => (orderId && o.id === orderId) || (contact && o.contact === contact && o.status !== "cancelled")
  );
  if (!order) return { error: "没找到这个预约，让客人报一下昵称或微信" };

  if (action === "cancel") {
    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();
    await save(data);
    return { ok: true, summary: `已取消 ${order.id}（${order.date} ${order.start}）`, status: STATUS_CN.cancelled };
  }

  if (action === "reschedule") {
    if (!newDate || !newStart) return { error: "改约要给我新的日期和时间" };
    const info = await checkSlots(newDate);
    if (info.closed) return { error: `新时间不行：${info.reason || "那天没空位"}` };
    const dur = order.hours || 2.5;
    const end = fmtMin(toMin(newStart) + Math.round(dur * 60));
    const clash = (data.orders || []).find(
      (o) => o.id !== order.id && o.date === newDate && ACTIVE.has(o.status) && overlap(newStart, end, o.start, o.end)
    );
    if (clash) return { error: `新时间冲突：${newDate} ${clash.start}–${clash.end} 已经有人了`, available: info.available };
    order.date = newDate;
    order.start = newStart;
    order.end = end;
    order.status = "rescheduled";
    order.note = [order.note, note].filter(Boolean).join("；");
    await save(data);
    return { ok: true, summary: `已改到 ${newDate} ${newStart}–${end}`, status: STATUS_CN.rescheduled };
  }

  if (action === "confirm") {
    order.status = "confirmed";
    await save(data);
    return { ok: true, summary: `已确认 ${order.id}`, status: STATUS_CN.confirmed };
  }

  return { error: `不认识的 action：${action}` };
}

export async function listOrders({ date } = {}) {
  const data = await load();
  const list = (data.orders || []).filter((o) => !date || o.date === date);
  return list.map((o) => ({
    id: o.id,
    date: o.date,
    time: `${o.start}–${o.end}`,
    name: o.name,
    contact: o.contact,
    style: o.style,
    price: o.price,
    status: STATUS_CN[o.status] || o.status,
  }));
}

export { todayStr, addDays, WEEK_CN, STATUS_CN };