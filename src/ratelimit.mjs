// 简易每日次数限制：同一个 IP 每天最多聊 N 轮
//
// 有 KV 环境变量时用 Redis 计数（原子 INCR，跨实例一致）
// 本地开发没有 KV 时退化成内存计数（重启清零）
import { useKV } from "./store.mjs";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const DAILY_LIMIT = Number(process.env.DAILY_CHAT_LIMIT || 5);

// 本地内存兜底
const mem = new Map();

function todayCN() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

/** 距离下一个自然日（东八区）还有多少秒 */
function secondsToTomorrow() {
  const now = Date.now();
  const cn = new Date(now + 8 * 3600e3);
  const nextMidnightCN = Date.UTC(cn.getUTCFullYear(), cn.getUTCMonth(), cn.getUTCDate() + 1) - 8 * 3600e3;
  return Math.max(60, Math.floor((nextMidnightCN - now) / 1000));
}

async function kvCmd(path) {
  const r = await fetch(`${KV_URL}/${path}`, {
    headers: { authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return (await r.json()).result;
}

/**
 * 记一次请求，返回是否还允许
 * @param {string} ip
 */
export async function hitChat(ip) {
  const safeIp = String(ip || "unknown").replace(/[^0-9a-zA-Z.:_-]/g, "").slice(0, 64);
  const key = `rl:chat:${todayCN()}:${safeIp}`;

  if (useKV) {
    const used = await kvCmd(`incr/${encodeURIComponent(key)}`);
    if (used === 1) {
      // 第一次写，设成当天结束自动过期
      await kvCmd(`expire/${encodeURIComponent(key)}/${secondsToTomorrow()}`);
    }
    return { used, limit: DAILY_LIMIT, allowed: used <= DAILY_LIMIT };
  }

  const used = (mem.get(key) || 0) + 1;
  mem.set(key, used);
  return { used, limit: DAILY_LIMIT, allowed: used <= DAILY_LIMIT };
}

/** 只查不计数（前端展示剩余次数用） */
export async function peekChat(ip) {
  const safeIp = String(ip || "unknown").replace(/[^0-9a-zA-Z.:_-]/g, "").slice(0, 64);
  const key = `rl:chat:${todayCN()}:${safeIp}`;
  let used = 0;
  try {
    used = useKV ? Number(await kvCmd(`get/${encodeURIComponent(key)}`)) || 0 : mem.get(key) || 0;
  } catch {
    used = 0;
  }
  return { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
}