// Vercel 入口：把所有请求交给同一套路由处理（见 src/app.mjs）
import { handle } from "../src/app.mjs";

export default async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}