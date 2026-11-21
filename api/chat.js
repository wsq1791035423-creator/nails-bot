// Vercel 函数：只处理 /api/chat
import { handle } from "../src/app.mjs";

export default async function handler(req, res) {
  await handle(req, res);
}
