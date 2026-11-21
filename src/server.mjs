// 本地启动：node src/server.mjs → http://127.0.0.1:8787
import http from "node:http";
import { handle } from "./app.mjs";
import { backupOrders } from "./store.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const server = http.createServer((req, res) => handle(req, res));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`报价器 demo: http://127.0.0.1:${PORT}`);
  console.log(`局域网访问: http://<你的电脑IP>:${PORT}`);
  try {
    const f = backupOrders();
    if (f) console.log(`订单已备份: ${f}`);
  } catch (e) {
    console.warn("备份失败:", e.message);
  }
});