// 档期管理：店主自己设置营业时间、休息日、取消预约
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "knowledge", "schedule.json");

const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const TZ = "+08:00";
const ACTIVE = new Set(["pending", "confirmed", "rescheduled"]);

function load() {
  const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (!d.orders) d.orders = [];
  if (!d.exceptions) d.exceptions = {};
  return d;
}
function save(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2), "utf8");
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

/** 未来 n 天，带实际档期和已约数量 */
export function upcomingDays(n = 21) {
  const d = load();
  const today = todayStr();
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i);
    const eff = effectiveRanges(d, date);
    const orders = (d.orders || []).filter((o) => o.date === date && ACTIVE.has(o.status));
    out.push({
      date,
      weekday: WEEK_CN[weekdayOf(date)],
      isToday: i === 0,
      closed: eff.closed || eff.ranges.length === 0,
      ranges: eff.ranges,
      note: eff.note,
      overridden: !!d.exceptions[date],
      orders: orders.map((o) => ({ id: o.id, start: o.start, end: o.end, name: o.name, style: o.style })),
      orderCount: orders.length,
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