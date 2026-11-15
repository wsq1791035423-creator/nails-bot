// 读取 .env（不引第三方依赖）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const p = path.join(__dirname, "..", ".env");
  const out = { ...process.env };
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export const ENV = loadEnv();
export const LLM_BASE = (ENV.DASHSCOPE_BASE_URL || "").replace(/\/$/, "");
export const LLM_KEY = ENV.DASHSCOPE_API_KEY || "";

export const MODELS = {
  chat: ENV.CHAT_MODEL || "qwen3.8-max",
  vision: ENV.VISION_MODEL || "qwen3-vl-plus",
};