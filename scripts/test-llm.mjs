// 测试端点连通性和可用模型
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const base = (env.DASHSCOPE_BASE_URL || "").replace(/\/$/, "");
const key = env.DASHSCOPE_API_KEY;
if (!base || !key) {
  console.log("缺 .env 里的 BASE_URL 或 KEY");
  process.exit(1);
}
console.log("base:", base);
console.log("key:", key.slice(0, 10) + "…（长度 " + key.length + "）");

async function tryFetch(url, opts) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  return { status: r.status, text };
}

// 1) 列模型
try {
  const r = await tryFetch(base + "/models", { headers: { authorization: `Bearer ${key}` } });
  console.log("\n[models]", r.status);
  console.log(r.text.slice(0, 1500));
} catch (e) {
  console.log("\n[models] 失败:", e.message);
}

// 2) 试探常见模型名
const candidates = ["qwen-plus", "qwen-max", "qwen-turbo", "deepseek-v3", "deepseek-chat", "qwen2.5-72b-instruct"];
for (const model of candidates) {
  try {
    const r = await tryFetch(base + "/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "只回复两个字：可用" }],
        max_tokens: 20,
      }),
    });
    const ok = r.status === 200;
    let preview = r.text.slice(0, 200).replace(/\s+/g, " ");
    console.log(`\n[${model}] ${r.status} ${ok ? "✅" : "❌"} ${preview}`);
    if (ok) break;
  } catch (e) {
    console.log(`\n[${model}] 失败: ${e.message}`);
  }
}