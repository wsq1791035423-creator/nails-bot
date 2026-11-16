// 数据读写：把「配置」和「订单」彻底分开
//
//   knowledge/schedule.json  → 营业时间、例外日、规则（跟代码一起进 git）
//   data/orders.json         → 订单数据（不进 git，只有本机有）
//
// 这样改代码、切分支、拉远程都不会碰订单。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "knowledge", "schedule.json");
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** 读配置（不含订单） */
export function readConfig() {
  const cfg = readJson(CONFIG_FILE, null);
  if (!cfg) {
    return {
      weekly: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
      exceptions: {},
      rules: { min_notice_hours: 24, max_days_ahead: 30, max_per_day: 2, slot_hours: 2.5 },
    };
  }
  // 兼容老文件：orders 曾经混在里面
  const { orders, ...rest } = cfg;
  if (!rest.exceptions) rest.exceptions = {};
  return rest;
}

/** 写配置（不含订单） */
export function writeConfig(cfg) {
  const clean = { ...cfg };
  delete clean.orders;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2), "utf8");
}

/** 读订单 */
export function readOrders() {
  let list = readJson(ORDERS_FILE, []);
  if (!Array.isArray(list)) list = [];

  // 从老文件迁移一次
  const cfg = readJson(CONFIG_FILE, null);
  if (cfg && Array.isArray(cfg.orders) && cfg.orders.length) {
    const ids = new Set(list.map((o) => o.id));
    const moved = cfg.orders.filter((o) => !ids.has(o.id));
    if (moved.length) {
      list = list.concat(moved);
      writeOrders(list);
    }
  }
  return list;
}

/** 写订单 */
export function writeOrders(list) {
  ensureDir(ORDERS_FILE);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(list, null, 2), "utf8");
}

/** 备份一份，防止误操作丢数据 */
export function backupOrders() {
  const list = readOrders();
  if (!list.length) return null;
  const dir = path.join(ROOT, "data", "backups");
  ensureDir(path.join(dir, "x"));
  const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `orders-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
  return file;
}

/** 合在一起返回，给旧代码用 */
export function loadAll() {
  return { ...readConfig(), orders: readOrders() };
}

/** 保存：自动分辨哪部分变了 */
export function saveAll(d) {
  const orders = d.orders || [];
  writeOrders(orders);
  writeConfig(d);
}