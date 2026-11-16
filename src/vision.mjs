// 视觉识别：把客人发来的参考图 / 手照，转成结构化属性 + 报价
// 原则：视觉模型只输出属性，价格由引擎算，模型不许直接报价。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM_BASE, LLM_KEY, MODELS } from "./env.mjs";
import { priceForStyle } from "./recommend-core.mjs";
import { skuIdsFor, styleLabelsFor } from "./style-map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "pricing.json"), "utf8"));

// 醋酸参考样本：店主提供的合集，作为 few-shot 例子一起发给视觉模型。
// 实测能显著提升醋酸识别率，且不干扰普通款。
const ACETATE_DIR = path.join(ROOT, "data", "reference", "acetate");
const ACETATE_EXAMPLES = ["acetate_02.jpeg", "acetate_03.jpeg", "acetate_04.jpeg"]
  .map((f) => path.join(ACETATE_DIR, f))
  .filter((p) => fs.existsSync(p))
  .map((p) => ({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(p).toString("base64")}` },
  }));

// 手绘参考样本：手绘经常被波点/法式盖过去认不出来，给两个例子
const HANDDRAW_EXAMPLES = ["013_手绘渐变腮红法式猫眼.jpeg", "017_卡通法式.jpeg"]
  .map((f) => path.join(ROOT, "data", "styles", f))
  .filter((p) => fs.existsSync(p))
  .map((p) => ({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(p).toString("base64")}` },
  }));
const STYLES = fs
  .readFileSync(path.join(ROOT, "knowledge", "03_styles.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

/** 在图库里找最接近的款，用来校正视觉识别的偏差 */
function matchSimilar(analysis) {
  const color = analysis.color || "";
  const styles = analysis.styles || [];
  const scored = STYLES.map((s) => {
    let score = 0;
    const t = s.tags || {};
    if (color && t.color && (t.color.includes(color) || color.includes(t.color))) score += 2;
    const hit = (t.style || []).filter((x) => styles.includes(x)).length;
    score += hit * 2;
    if (analysis.length && t.length === analysis.length) score += 1;
    return { style: s, score };
  })
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 2).map((x) => x.style);
}

const PROMPT = `你是美甲款式识别器。看这张图，只输出一个 JSON 对象，不要任何解释和 markdown。

{
  "is_nail": true 或 false,
  "kind": "参考款式图" 或 "客人的手" 或 "无关图片",
  "color": 从 [裸色, 粉, 红, 蓝绿, 紫, 黑白灰, 金属, 多色, 透明] 里选一个最接近的,
  "styles": 从 [纯色, 猫眼, 法式, 波点, 腮红, 渐变, 晕染, 手绘, 卡通, 贴钻, 堆钻, 浮雕, 醋酸, 魔镜粉, 海莉粉, 亮片, 碎钻] 里选，可多选，最多 4 个,
  "length": 从 [短, 中, 长, 延长] 里选,
  "shape": 从 [方圆, 椭圆, 方, 圆, 杏仁, 尖杏仁, 尖椭圆, 尖, 梯形, 看不清] 里选,
  "nail_bed": 从 [短宽, 长窄, 正常, 看不清] 里选（判断客人的甲床）,
  "confidence": 0 到 1 之间的小数,
  "note": 一句话补充，比如"手部特写，甲面偏薄"
}

规则：
- 不是美甲内容的图，is_nail 填 false，其他字段留空数组/空字符串
- 拿不准的 styles 不要写进去，宁可少写
- 不要描述你没看到的东西

判断线索（重要）：
- 波点：均匀的小圆点，一批一批的
- 法式：指甲尖端有一条不同颜色的边
- 猫眼：甲面有随角度移动的竖向光带
  注意："法式猫眼"算猫眼，不要额外标法式；只有甲尖明显有一条不同颜色的边，才算加法式。
- 醋酸：指甲表面贴着明显的半透明立体片、球或花，能看出厚度和轮廓，像果冻块。
  只是"有光泽""亮亮的""反光"不算醋酸——那是封层或亮片，不要写。
- 海莉粉 / 魔镜粉：整片甲面像镀了一层珠光或镜面薄膜，有金属感光泽，没有颗粒
- 贴钻：明显的水钻、钻石，有切割反光
- 浮雕：凸起的立体花纹，不是平的
- 晕染：颜色像水彩一样化开，边界不规则，没有固定方向
- 渐变：颜色从一种过渡到另一种，有明确方向（指尖深甲根浅、或斜向），能看出层次
  渐变和晕染最容易混：有方向、有层次 → 写渐变；多种颜色随意融在一起 → 写晕染。
  但**必须有颜色变化**才算渐变：
  - 猫眼的竖向光带 → 是猫眼，不是渐变
  - 珠光、亮片、甲面高光的整体反光 → 不是渐变
  - 整个甲面只有一种颜色，只是亮暗不均 → 不是渐变

  重要：说不清"从哪个颜色过渡到哪个颜色"，就不要写渐变。
  拿不准就不写——少算钱，客人到店你自己核实；多算了客人拿着截图来对，更麻烦。
- 手绘：甲面上有"画上去"的图案——线条、小花、蝴蝶、字母、小动物、简笔画、卡通形象。
  只要能看出是用笔画的（不是贴上去的钻、不是胶做的立体），就要标手绘。
  注意：手绘经常和波点、法式、渐变混在一起出现，看到图案就单独加一个「手绘」，别被别的元素盖过去。
  宁可标，不要漏——漏了报价会少算。

甲型怎么判断（先看指尖，再看两侧）：
先问一句：指尖有没有往中间收、有没有尖的趋势？
- 完全没收，指尖是平线 → 方
- 完全没收，指尖圆弧 → 圆 / 椭圆（长的叫椭圆）
- 收了，但圆润 → 杏仁
- 收了，且明显尖 → 尖 / 尖椭圆

具体：
- 方：指尖一条平线，两侧直角，边缘锋利
- 方圆：指尖平，两个角磨圆，**指尖整体仍是平的**
- 圆：指尖圆弧，指甲短、宽窄接近
- 椭圆：比圆长，两侧基本平行或只微微收，**指尖是圆润的弧、不收尖**
- 杏仁：两侧从甲根就开始收窄，整体像杏仁，**尖端圆润不锋利**
- 尖杏仁：杏仁的收窄基础上，尖端再明显收尖一点
- 尖椭圆：椭圆的基础上指尖明显收尖，能看出尖的趋势
- 尖：尖端窄而锋利
- 梯形：指尖比甲根宽，往外扩
- 看不清：角度或光线让轮廓模糊，就填看不清

重要：不要过度往"尖"上猜。
没有明显收尖的趋势，就选 椭圆 或 方圆，不要选 尖椭圆 / 杏仁。
"看着有点尖"不等于尖——要能明显看出指尖变窄才算。

严格要求：只有非常确定才写进 styles。宁可漏，不要错。
判错一个做法，报价就会错，客人到店会发现，比不写严重得多。`;

export async function analyzeImage(base64, mime = "image/jpeg") {
  const body = {
    model: MODELS.vision,
    messages: [
      {
        role: "user",
        content: [
          ...(ACETATE_EXAMPLES.length
            ? [{ type: "text", text: "下面 3 张是【醋酸】款式的样子：指甲上贴着半透明、有厚度的果冻质感片/球/花。只作参考。" }, ...ACETATE_EXAMPLES]
            : []),
          ...(HANDDRAW_EXAMPLES.length
            ? [{ type: "text", text: "下面 2 张是【手绘】的样子：甲面上有画上去的图案、线条、卡通形象。只作参考。" }, ...HANDDRAW_EXAMPLES]
            : []),
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 400,
    temperature: 0.1,
  };

  const r = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${LLM_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`视觉模型 ${r.status}: ${text.slice(0, 400)}`);

  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/```json|```/g, "").trim();
  let analysis;
  try {
    analysis = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "识别结果不是 JSON", raw: content };
  }

  if (!analysis.is_nail) {
    return { ok: false, analysis, reply: "这张图我这边看不太出美甲信息，能再发一张清晰点的吗？" };
  }

  const styles = Array.isArray(analysis.styles) ? analysis.styles : [];

  // 猫眼的光带很容易被误判成渐变。店主确认：同时出现时按猫眼算，渐变不加钱。
  // 少算了她到店自己核实；多算客人会拿截图来对。
  let finalStyles = styles;
  let downgraded = false;
  if (styles.includes("猫眼") && styles.includes("渐变")) {
    finalStyles = styles.filter((s) => s !== "渐变");
    downgraded = true;
  }

  const styleIds = skuIdsFor(finalStyles);
  const labels = styleLabelsFor(finalStyles);

  // 用视觉识别出的做法，按「整手」估一个价
  const fakeStyle = {
    id: "VISION",
    name: "参考图",
    tags: {
      color: analysis.color || "",
      style: finalStyles,
      length: analysis.length || "",
      extend: "不需要",
      difficulty: "中",
      skin_effect: "",
      occasion: [],
      hand_fit: [],
    },
    style_ids: styleIds,
    style_labels: labels,
  };
  const quote = priceForStyle(PRICING, fakeStyle);
  const similar = matchSimilar(analysis).map((s) => ({
    id: s.id,
    name: s.name,
    img: s.img,
    price: priceForStyle(PRICING, s).totalText,
    tags: s.tags,
  }));

  return {
    ok: true,
    analysis: { ...analysis, styles: finalStyles },
    downgraded,
    similar,
    quote: {
      total: quote.totalText,
      duration: quote.durationText,
      lines: quote.lines.map((l) => `${l.label}：${l.amount}`),
      extra: quote.extraText || null,
      from: quote.isFrom,
    },
  };
}