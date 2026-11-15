// Node 版报价入口：读 pricing.json，跑算例。
// 运行：node src/pricing.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quote, lateFee, stylePrice, feePrice } from "./pricing-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRICING = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "knowledge", "pricing.json"), "utf8")
);

export const q = (query) => quote(PRICING, query);
export { quote, lateFee, stylePrice, feePrice, PRICING };

// ---------- 自测算例 ----------
if (process.argv[1] && process.argv[1].endsWith("pricing.mjs")) {
  const cases = [
    { label: "本甲 + 整手法式", q: { baseId: "B1", styles: [{ id: "S2F", fingers: 10 }] } },
    { label: "腮红 5 指 + 波点 5 指（共 10 指次，应 8 元）", q: { baseId: "B1", styles: [{ id: "S2B", fingers: 5 }, { id: "S2D", fingers: 5 }] } },
    { label: "腮红 10 指 + 波点 10 指（共 20 指次，应 16 元）", q: { baseId: "B1", styles: [{ id: "S2B", fingers: 10 }, { id: "S2D", fingers: 10 }] } },
    { label: "本甲 + 2 指法式", q: { baseId: "B1", styles: [{ id: "S2F", fingers: 2 }] } },
    { label: "浅贴延长 + 整手魔镜粉", q: { baseId: "B4", styles: [{ id: "S7", fingers: 10 }] } },
    { label: "本甲 + 2 指卡通（区间待确认）", q: { baseId: "B1", styles: [{ id: "S5", fingers: 2 }] } },
    { label: "本甲 + 断甲修补 2 指", q: { baseId: "B1", fees: [{ id: "F1", count: 2 }] } },
    { label: "高位半贴 + 纯色", q: { baseId: "B3" } },
    { label: "本甲 + 整手法式 + 迟到 25 分钟", q: { baseId: "B1", styles: [{ id: "S2F", fingers: 10 }], lateMinutes: 25 } },
    { label: "迟到 40 分钟", q: { baseId: "B1", lateMinutes: 40 } },
  ];

  for (const c of cases) {
    const r = q(c.q);
    console.log(`\n【${c.label}】`);
    for (const l of r.lines) console.log(`  - ${l.label.padEnd(30)} ${l.amount.padEnd(10)} ${l.note}`);
    console.log(`  合计：${r.totalText}   ${r.cancelled ? "⛔ 已取消" : ""}`);
    console.log(`  时长：${r.durationText}`);
    if (r.pending.length) console.log(`  ⚠ 待确认：${[...new Set(r.pending)].join(" / ")}`);
  }
}
