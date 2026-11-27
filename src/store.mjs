// 数据读写：配置 + 订单
//
// 本地：写文件（knowledge/schedule.json、data/orders.json）
// Vercel：写 Vercel KV（Upstash Redis），靠 KV_REST_API_URL / KV_REST_API_TOKEN 两个环境变量
//
// 两套实现对外都是 async，调用方统一 await。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "knowledge", "schedule.json");
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const useKV = Boolean(KV_URL && KV_TOKEN);

const DEFAULT_CONFIG = {
  weekly: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
  exceptions: {},
  rules: { min_notice_hours: 24, max_days_ahead: 30, max_per_day: 2, slot_hours: 2.5 },
};

// ---------- KV 读写（零依赖，直接打 Upstash REST）----------
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`KV 读取失败 ${r.status}`);
  const j = await r.json();
  return j.result == null ? null : j.result;
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KV_TOKEN}`, "content-type": "text/plain" },
    body: value,
  });
  if (!r.ok) throw new Error(`KV 写入失败 ${r.status}`);
}

// ---------- 本地文件读写 ----------
function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readFileJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ---------- 对外：配置 ----------
export async function readConfig() {
  let raw = null;
  if (useKV) {
    raw = await kvGet("schedule:config");
  } else {
    raw = readFileJson(CONFIG_FILE, null);
  }
  let cfg;
  try {
    cfg = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
  } catch {
    cfg = null;
  }
  if (!cfg) return { ...DEFAULT_CONFIG, exceptions: {} };
  const { orders, ...rest } = cfg;
  if (!rest.exceptions) rest.exceptions = {};
  return rest;
}

export async function writeConfig(cfg) {
  const clean = { ...cfg };
  delete clean.orders;
  const text = JSON.stringify(clean, null, 2);
  if (useKV) {
    await kvSet("schedule:config", text);
    return;
  }
  fs.writeFileSync(CONFIG_FILE, text, "utf8");
}

// ---------- 对外：订单 ----------
export async function readOrders() {
  let list;
  if (useKV) {
    const raw = await kvGet("schedule:orders");
    try {
      list = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
    } catch {
      list = [];
    }
  } else {
    list = readFileJson(ORDERS_FILE, []);
    // 老版本把订单混在配置里，迁移一次
    const cfg = readFileJson(CONFIG_FILE, null);
    if (cfg && Array.isArray(cfg.orders) && cfg.orders.length) {
      const ids = new Set(list.map((o) => o.id));
      const moved = cfg.orders.filter((o) => !ids.has(o.id));
      if (moved.length) {
        list = list.concat(moved);
        writeOrdersSync(list);
      }
    }
  }
  return Array.isArray(list) ? list : [];
}

function writeOrdersSync(list) {
  ensureDir(ORDERS_FILE);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(list, null, 2), "utf8");
}

export async function writeOrders(list) {
  const text = JSON.stringify(list, null, 2);
  if (useKV) {
    await kvSet("schedule:orders", text);
    return;
  }
  writeOrdersSync(list);
}

// ---------- 合计 ----------
export async function loadAll() {
  const [cfg, orders] = await Promise.all([readConfig(), readOrders()]);
  return { ...cfg, orders };
}

export async function saveAll(d) {
  const orders = d.orders || [];
  await Promise.all([writeOrders(orders), writeConfig(d)]);
}

// 本地备份（Vercel 上不适用，直接跳过）
export function backupOrders() {
  if (useKV) return null;
  const list = readFileJson(ORDERS_FILE, []);
  if (!Array.isArray(list) || !list.length) return null;
  const dir = path.join(ROOT, "data", "backups");
  ensureDir(path.join(dir, "x"));
  const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `orders-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
  return file;
}