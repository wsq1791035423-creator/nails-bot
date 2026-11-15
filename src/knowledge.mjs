// 美甲知识库：按关键词检索片段，注入对话上下文（不整篇塞 prompt）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "knowledge", "07_beauty-knowledge.md");

let sections = null;

function load() {
  if (sections) return sections;
  sections = {};
  if (!fs.existsSync(FILE)) return sections;
  const text = fs.readFileSync(FILE, "utf8");
  const parts = text.split(/\n## /);
  for (const p of parts) {
    // 取第一行当标题，去掉「一、」这类编号前缀
    const firstLine = p.split("\n")[0].trim();
    if (!firstLine) continue;
    const title = firstLine.replace(/^[一二三四五六七八九十]+、/, "").trim();
    sections[title] = "## " + p.trim();
  }
  return sections;
}

const RULES = [
  { re: /流行|趋势|今年|2026|爆款|最近火|时下/, keys: ["2026 流行趋势"] },
  { re: /显白|配色|肤色|黄黑|衬手|衬肤|显手白/, keys: ["显白配色原理（通用）"] },
  { re: /甲型|手型|方圆|杏仁|指甲形状|甲床/, keys: ["甲型与手型"] },
  { re: /建构|甲膜|半贴|浅贴|封层|前置处理|工艺/, keys: ["术语（客人常问）"] },
  { re: /维持|多久|伤甲|撕|变薄|脱落|翘/, keys: ["常见误区（客人爱问的）"] },
];

/** 根据客人这句话，取出相关的知识片段 */
export function beautyContext(text) {
  const all = load();
  if (!Object.keys(all).length) return "";

  const picked = new Set();
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    for (const k of rule.keys) {
      if (all[k]) picked.add(all[k]);
    }
  }
  return [...picked].join("\n\n");
}