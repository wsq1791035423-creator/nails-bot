// HTTP 路由处理：本地由 src/server.mjs 调用，云端由 api/index.js 调用。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./llm.mjs";
import { readSchedule, saveDay, saveWeekly, cancelOrder, createOrder, upcomingDays } from "./schedule-admin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

function json(res, data, code = 200) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export async function handle(req, res) {
  const parsed = new URL(req.url ?? "/", "http://localhost");
  // Vercel 的 rewrite 会把 URL 换成目标路径，原路径我们放在 __path 里带过来
  const rewrote = parsed.searchParams.get("__path");
  const urlPath = rewrote
    ? "/api/" + rewrote
    : decodeURIComponent(parsed.pathname);

  // ---- 对话接口 ----
  if (req.method === "POST" && urlPath === "/api/chat") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const body = JSON.parse(raw || "{}");
      const result = await chat(body.messages ?? [], body.image);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  // ---- 档期管理接口 ----
  if (req.method === "GET" && urlPath === "/api/schedule") {
    try {
      const cfg = await readSchedule();
      json(res, { ...cfg, days: await upcomingDays(21) });
    } catch (e) {
      json(res, { error: String(e.message || e) }, 500);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/schedule/day") {
    try {
      const body = await readBody(req);
      json(res, await saveDay(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/schedule/weekly") {
    try {
      const body = await readBody(req);
      json(res, await saveWeekly(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/orders/cancel") {
    try {
      const body = await readBody(req);
      json(res, await cancelOrder(body.id));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/orders/create") {
    try {
      const body = await readBody(req);
      json(res, await createOrder(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  // ---- 效果图任务查询（已停用：云端不跑生图）----
  const looksMatch = urlPath.match(/^\/api\/looks\/([A-Za-z0-9]+)$/);
  if (req.method === "GET" && looksMatch) {
    json(res, { status: "disabled", note: "生图功能已关闭" });
    return;
  }

  // 路径映射：根、/chat.html 都指向 web/ 下的页面；其余照旧
  const ALIAS = {
    "/": "/web/index.html",
    "/chat.html": "/web/chat.html",
    "/schedule.html": "/web/schedule.html",
    "/recommend.html": "/web/recommend.html",
    "/gallery.html": "/web/gallery.html",
  };
  let rel = ALIAS[urlPath] || urlPath;
  let file = path.resolve(ROOT, "." + rel);

  // 再退一步：public/ 里如果有，就用 public/ 的
  if (!fs.existsSync(file)) {
    const pubFile = path.resolve(ROOT, "./public" + rel);
    if (pubFile.startsWith(path.join(ROOT, "public")) && fs.existsSync(pubFile)) {
      file = pubFile;
    }
  }

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 " + urlPath);
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": process.env.VERCEL ? "public, max-age=300" : "no-store",
  });
  fs.createReadStream(file).pipe(res);
}
export default handle;


