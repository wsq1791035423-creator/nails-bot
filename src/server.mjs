// 极简静态服务器：node src/server.mjs → http://127.0.0.1:8787
// 只服务本目录，不依赖任何第三方包。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chat } from "./llm.mjs";
import { getLooks, retryLooks } from "./imagegen.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8787);

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

const server = http.createServer(async (req, res) => {
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

  // ---- 效果图任务查询 ----
  const looksMatch = urlPath.match(/^\/api\/looks\/([A-Za-z0-9]+)$/);
  if (req.method === "GET" && looksMatch) {
    const id = looksMatch[1];
    // 服务重启后内存任务会丢，自动用原参数重开一个
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

  // 防路径穿越
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  // 目录 → index.html
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 " + urlPath);
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`报价器 demo: http://127.0.0.1:${PORT}`);
  console.log(`局域网访问: http://<你的电脑IP>:${PORT}`);
});