// 推荐引擎 CLI 测试：node src/recommend.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommend } from "./recommend-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "pricing.json"), "utf8"));
const STYLES = fs
  .readFileSync(path.join(ROOT, "knowledge", "03_styles.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const cases = [
  { label: "手黄黑 · 短甲 · 日常 · 预算 60", prefs: { skin: "黄黑", length: "短", occasion: "日常", budget: 60 } },
  { label: "手白 · 想显手细 · 约会", prefs: { skin: "冷白", length: "中长", occasion: "约会", budget: 150 } },
  { label: "明确想要猫眼", prefs: { keywords: ["猫眼"], budget: 100 } },
  { label: "想做卡通但别太贵", prefs: { keywords: ["卡通"], budget: 120 } },
  { label: "不想做延长 · 短甲 · 通勤", prefs: { length: "短", occasion: "通勤", wantExtend: false, skin: "黄黑" } },
];

for (const c of cases) {
  console.log(`\n======== ${c.label} ========`);
  const res = recommend(PRICING, STYLES, c.prefs);
  for (const r of res) {
    const flags = [r.priceConfirm ? "⚠价待确认" : "", r.overBudget ? "⚠超预算" : ""].filter(Boolean).join(" ");
    console.log(`  ${r.name.padEnd(22)} ${r.priceText.padEnd(12)} ${r.durationText}  ${flags}`);
    if (r.extraText) console.log(`     另计：${r.extraText}`);
    console.log(`     明细：${r.lines.map((l) => `${l.label} ${l.amount}`).join(" + ")}`);
    console.log(`     理由：${r.reason}`);
    console.log(`     标签：${r.tags.color} / ${r.tags.style.join("、")} / ${r.tags.length} / ${r.tags.skin_effect}`);
  }
}