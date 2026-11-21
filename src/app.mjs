// HTTP 路由处理：本地由 src/server.mjs 调用，云端由 api/index.js 调用。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./llm.mjs";
import { getLooks, retryLooks } from "./imagegen.mjs";
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
  if (urlPath === "/api/__files") {
    const ls = (d) => { try { return fs.readdirSync(d).slice(0, 20); } catch (e) { return "ERR:" + e.message; } };
    return json(res, { cwd: process.cwd(), root: ROOT, cwdList: ls(process.cwd()), rootList: ls(ROOT), web: ls(path.join(ROOT, "web")), kn: ls(path.join(ROOT, "knowledge")) });
  }
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);

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
      json(res, { ...readSchedule(), days: upcomingDays(21) });
    } catch (e) {
      json(res, { error: String(e.message || e) }, 500);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/schedule/day") {
    try {
      const body = await readBody(req);
      json(res, saveDay(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/schedule/weekly") {
    try {
      const body = await readBody(req);
      json(res, saveWeekly(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/orders/cancel") {
    try {
      const body = await readBody(req);
      json(res, cancelOrder(body.id));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  if (req.method === "POST" && urlPath === "/api/orders/create") {
    try {
      const body = await readBody(req);
      json(res, createOrder(body));
    } catch (e) {
      json(res, { error: String(e.message || e) }, 400);
    }
    return;
  }

  // ---- 效果图任务查询 ----
  const looksMatch = urlPath.match(/^\/api\/looks\/([A-Za-z0-9]+)$/);
  if (req.method === "GET" && looksMatch) {
    const id = looksMatch[1];
    let task = getLooks(id);
    if (!task) {
      const newId = retryLooks(id);
      task = newId ? getLooks(newId) : { status: "missing" };
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(task));
    return;
  }

  let rel = urlPath === "/" ? "/web/index.html" : urlPath;
  let file = path.resolve(ROOT, "." + rel);

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

