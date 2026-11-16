// 档期管理：店主自己设置营业时间、休息日、取消预约
import { loadAll, saveAll } from "./store.mjs";

const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const TZ = "+08:00";
const ACTIVE = new Set(["pending", "confirmed", "rescheduled"]);

function load() {
  const d = loadAll();
  if (!d.exceptions) d.exceptions = {};
  return d;
}
function save(d) {
  saveAll(d);
}
function todayStr() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00${TZ}`);
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T12:00:00${TZ}`).getDay();
}
function validRange(r) {
  return Array.isArray(r) && r.length === 2 && /^\d{2}:\d{2}$/.test(r[0]) && /^\d{2}:\d{2}$/.test(r[1]) && r[0] < r[1];
}

/** 读完整档期 */
export function readSchedule() {
  const d = load();
  return {
    weekly: d.weekly,
    exceptions: d.exceptions,
    rules: d.rules,
    orders: (d.orders || []).map((o) => ({
      id: o.id,
      date: o.date,
      start: o.start,
      end: o.end,
      name: o.name,
      contact: o.contact,
      style: o.style,
      price: o.price,
      shape: o.shape,
      note: o.note,
      status: o.status,
      statusText: {
        pending: "待确认",
        confirmed: "已确认",
        rescheduled: "改约",
        cancelled: "已取消",
        done: "已完成",
      }[o.status] || o.status,
    })),
  };
}

/** 某天实际生效的时间段（考虑例外） */
function effectiveRanges(d, dateStr) {
  const ex = d.exceptions[dateStr];
  if (ex?.closed) return { closed: true, ranges: [], note: ex.note || "" };
  if (ex?.ranges?.length) return { closed: false, ranges: ex.ranges, note: ex.note || "" };
  const wd = String(weekdayOf(dateStr));
  return { closed: false, ranges: d.weekly[wd] ?? [], note: "" };
}

function toMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 从营业时段里扣掉已约的段，算出空闲和占用 */
function splitDay(ranges, orders) {
  const free = [];
  const taken = [];
  for (const [start, end] of ranges) {
    let segs = [[toMin(start), toMin(end)]];
    for (const o of orders) {
      const bs = toMin(o.start);
      const be = toMin(o.end);
      if (be <= toMin(start) || bs >= toMin(end)) continue;
      taken.push({ start: o.start, end: o.end, name: o.name, style: o.style, id: o.id });
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
    for (const [s, e] of segs) {
      if (e - s >= 30) free.push([fmtMin(s), fmtMin(e)]);
    }
  }
  taken.sort((a, b) => a.start.localeCompare(b.start));
  return { free, taken };
}

/** 未来 n 天，带实际档期、已约时段、剩余空闲 */
export function upcomingDays(n = 21) {
  const d = load();
  const today = todayStr();
  const noticeH = d.rules.min_notice_hours ?? 24;
  const earliest = new Date(Date.now() + noticeH * 3600 * 1000);
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    const eff = effectiveRanges(d, date);
    const orders = (d.orders || []).filter((o) => o.date === date && ACTIVE.has(o.status));
    const { free, taken } = splitDay(eff.ranges, orders);

    // 不够提前量的时段不能约，剔除掉（和 bot 的判断保持一致）
    const bookable = free.filter(
      ([s]) => new Date(`${date}T${s}:00${TZ}`) >= earliest
    );
    const tooSoon = free.length > 0 && bookable.length === 0;

    const maxPerDay = d.rules.max_per_day ?? 2;
    out.push({
      date,
      weekday: WEEK_CN[weekdayOf(date)],
      isToday: i === 0,
      closed: eff.closed || eff.ranges.length === 0,
      ranges: eff.ranges,
      note: eff.note,
      overridden: !!d.exceptions[date],
      orders: orders.map((o) => ({
        id: o.id, start: o.start, end: o.end, name: o.name, style: o.style, status: o.status,
      })),
      orderCount: orders.length,
      freeSegments: bookable,
      takenSegments: taken,
      tooSoon,
      noticeHours: noticeH,
      maxPerDay,
      full: orders.length >= maxPerDay || (eff.ranges.length > 0 && bookable.length === 0),
    });
  }
  return out;
}

/** 保存某一天的档期（写进 exceptions） */
export function saveDay({ date, closed, ranges, note }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { error: "日期格式不对" };
  const d = load();

  if (closed) {
    // 这天已有订单时提醒
    const busy = (d.orders || []).filter((o) => o.date === date && ACTIVE.has(o.status));
    d.exceptions[date] = { closed: true, note: note || "休息" };
    save(d);
    return {
      ok: true,
      warning: busy.length ? `注意：这天还有 ${busy.length} 个未完成的预约，记得通知客人改期` : null,
    };
  }

  const clean = (ranges || []).filter(validRange);
  if (!clean.length) return { error: "至少要留一个有效的时间段（开始 < 结束）" };
  d.exceptions[date] = { ranges: clean, note: note || "" };
  save(d);
  return { ok: true };
}

/** 设置每周固定营业时间 */
export function saveWeekly({ weekday, ranges }) {
  const wd = String(weekday);
  if (!/^[0-6]$/.test(wd)) return { error: "weekday 要是 0–6" };
  const clean = (ranges || []).filter(validRange);
  const d = load();
  d.weekly[wd] = clean;
  save(d);
  return { ok: true, weekday: wd, ranges: clean };
}

/** 取消预约 */
export function cancelOrder(id) {
  const d = load();
  const o = (d.orders || []).find((x) => x.id === id);
  if (!o) return { error: "没找到这个预约" };
  o.status = "cancelled";
  o.cancelledAt = new Date().toISOString();
  save(d);
  return { ok: true, summary: `已取消 ${o.id}（${o.date} ${o.start} ${o.name}）` };
}

function nextOrderId(d) {
  const nums = (d.orders || [])
    .map((o) => Number(String(o.id).replace(/\D/g, "")))
    .filter((n) => !Number.isNaN(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return "O" + String(n).padStart(3, "0");
}

/** 店主手动补录一单（客人是微信/当面约的） */
export function createOrder({ date, start, hours, name, contact, style, price, note }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return { error: "日期格式不对" };
  if (!/^\d{2}:\d{2}$/.test(start || "")) return { error: "时间格式不对，要 14:30 这种" };
  if (!name || !String(name).trim()) return { error: "客人的称呼填一下吧" };

  const d = load();
  const dur = Number(hours) || d.rules.slot_hours || 2.5;
  const [h, m] = start.split(":").map(Number);
  const endMin = h * 60 + m + Math.round(dur * 60);
  const end = fmtMin(endMin);
  if (endMin > 24 * 60) return { error: "结束时间超过 24 点了，时长或开始时间改一下" };

  const warnings = [];

  // 撞单检查
  const clash = (d.orders || []).find(
    (o) => o.date === date && ACTIVE.has(o.status) && toMin(start) < toMin(o.end) && toMin(o.start) < endMin
  );
  if (clash) {
    return {
      error: `${date} ${clash.start}–${clash.end} 已经排了${clash.name}（${clash.style || "款式待定"}），时间重叠了`,
    };
  }

  // 当天没排班时提醒，但不拦着
  const eff = effectiveRanges(d, date);
  if (eff.closed || eff.ranges.length === 0) {
    warnings.push("这天你原本设的是休息，记得在档期里把它改成营业");
  } else {
    const inside = eff.ranges.some(([s, e]) => toMin(start) >= toMin(s) && endMin <= toMin(e));
    if (!inside) warnings.push(`这单 ${start}–${end} 不在你设的营业时间内（${eff.ranges.map((r) => r[0] + "–" + r[1]).join("、")}）`);
  }

  const maxPerDay = d.rules.max_per_day ?? 2;
  const sameDay = (d.orders || []).filter((o) => o.date === date && ACTIVE.has(o.status)).length;
  if (sameDay >= maxPerDay) warnings.push(`这天已经有 ${sameDay} 单，超过你设的每天 ${maxPerDay} 单上限了`);

  const entry = {
    id: nextOrderId(d),
    date,
    start,
    end,
    name: String(name).trim(),
    contact: (contact || "").trim(),
    style: (style || "").trim(),
    price: price === "" || price == null ? null : Number(price),
    shape: "",
    hours: dur,
    note: (note || "").trim(),
    status: "confirmed", // 店主自己录的，默认已确认
    source: "manual",
    createdAt: new Date().toISOString(),
  };
  d.orders.push(entry);
  save(d);

  return {
    ok: true,
    orderId: entry.id,
    summary: `已记录：${date} ${start}–${end}，${entry.name}，${entry.style || "款式待定"}`,
    warning: warnings.length ? warnings.join("；") : null,
  };
}