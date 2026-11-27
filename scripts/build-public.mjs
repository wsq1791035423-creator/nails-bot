// Vercel 构建时把静态资源复制到 public/，由 CDN 直接托管（不经过函数）
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUB = path.join(ROOT, "public");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`跳过（不存在）：${path.relative(ROOT, src)}`);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(PUB, { recursive: true, force: true });

copyDir(path.join(ROOT, "web"), path.join(PUB, "web"));
copyDir(path.join(ROOT, "knowledge"), path.join(PUB, "knowledge"));
copyDir(path.join(ROOT, "data", "styles", "web"), path.join(PUB, "data", "styles", "web"));
copyDir(path.join(ROOT, "data", "reference"), path.join(PUB, "data", "reference"));

// 根路径直接是报价器
const quote = path.join(PUB, "web", "index.html");
if (fs.existsSync(quote)) fs.copyFileSync(quote, path.join(PUB, "index.html"));

// 对话页放根目录，分享时链接更短
const chat = path.join(PUB, "web", "chat.html");
if (fs.existsSync(chat)) fs.copyFileSync(chat, path.join(PUB, "chat.html"));

const count = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
};

console.log(`public/ 构建完成，共 ${count(PUB)} 个文件`);