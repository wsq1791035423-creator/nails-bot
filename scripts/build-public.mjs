// 构建时把静态资源复制到 public/，Vercel 会直接托管（不经过函数）
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUB = path.join(ROOT, "public");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
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

// 根路径展示报价器
const index = path.join(PUB, "web", "index.html");
if (fs.existsSync(index)) fs.copyFileSync(index, path.join(PUB, "index.html"));

console.log("public/ 构建完成");