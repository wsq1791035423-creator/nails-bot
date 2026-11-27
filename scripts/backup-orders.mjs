// 把订单备份到 GitHub
// 用法：node scripts/backup-orders.mjs
//
// 会在仓库里生成 backups/orders-YYYY-MM-DD-HHmm.json，然后自动 commit + push。
// 注意：里面包含客人姓名和微信，仓库是 Private 才安全。
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ORDERS = path.join(ROOT, "data", "orders.json");
const OUT_DIR = path.join(ROOT, "backups");

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

if (!fs.existsSync(ORDERS)) {
  console.log("没有 data/orders.json，跳过");
  process.exit(0);
}

const raw = fs.readFileSync(ORDERS, "utf8");
let orders;
try {
  orders = JSON.parse(raw);
} catch {
  console.error("data/orders.json 不是合法 JSON，先检查一下");
  process.exit(1);
}

if (!Array.isArray(orders) || orders.length === 0) {
  console.log("当前没有订单，不用备份");
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const now = new Date(Date.now() + 8 * 3600e3);
const stamp = now.toISOString().replace(/[:T]/g, "-").slice(0, 16);
const file = path.join(OUT_DIR, `orders-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify(orders, null, 2), "utf8");

const active = orders.filter((o) => ["pending", "confirmed", "rescheduled"].includes(o.status));
console.log(`备份 ${orders.length} 条订单（其中未完成 ${active.length} 条）`);
console.log(`文件：backups/${path.basename(file)}`);

// 只提交这个备份文件，别把工作区其他改动带进去
try {
  sh(`git add "backups/${path.basename(file)}"`);
  const msg = `备份订单 ${stamp.slice(0, 10)}（${orders.length} 条）`;
  sh(`git -c core.quotepath=false commit -m "${msg}" -- "backups/${path.basename(file)}"`);
  console.log("已提交，正在推送…");
  let pushed = false;
  for (let i = 1; i <= 3; i++) {
    try {
      const out = sh("git push");
      pushed = true;
      break;
    } catch (e) {
      if (i === 3) throw e;
      console.log(`第 ${i} 次推送失败，重试…`);
      execSync("timeout /t 4 /nobreak >nul 2>&1 || sleep 4", { cwd: ROOT, shell: true });
    }
  }
  if (pushed) console.log("✓ 已推送到 GitHub");
} catch (e) {
  console.error("提交或推送失败：");
  console.error(String(e.stderr || e.message).trim());
  console.error("\n备份文件已生成，可手动提交：");
  console.error(`  git add backups/${path.basename(file)}`);
  console.error(`  git commit -m "备份订单" && git push`);
  process.exit(1);
}