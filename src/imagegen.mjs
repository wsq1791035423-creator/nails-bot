// 文生图：根据客人的颜色 / 风格生成美甲效果图
import { LLM_BASE, LLM_KEY } from "./env.mjs";

const COLOR_EN = {
  裸色: "nude beige",
  裸色系: "nude beige",
  乳白: "milky white",
  白: "white",
  黑: "black",
  红: "red",
  粉: "soft pink",
  玫红: "rose red",
  紫: "purple",
  蓝绿: "blue green",
  深蓝: "deep blue",
  绿: "green",
  橙: "orange",
  银: "silver metallic",
  金属: "metallic",
  透明: "clear",
  多色: "multicolor",
  薄荷绿: "mint green",
  桃粉: "peach pink",
  莓果: "berry wine",
  云舞白: "cloud dancer white",
  酒红: "wine red",
  墨绿: "deep emerald",
  奶茶色: "milky tea beige",
};

const STYLE_EN = {
  纯色: "solid color",
  猫眼: "cat eye",
  法式: "french tip",
  波点: "polka dot",
  腮红: "blush",
  渐变: "gradient",
  晕染: "watercolor ombre",
  手绘: "hand painted line art",
  卡通: "cute cartoon art",
  贴钻: "rhinestones",
  堆钻: "stacked rhinestones",
  浮雕: "3d relief",
  醋酸: "translucent acetate pieces",
  魔镜粉: "chrome powder mirror finish",
  海莉粉: "glazed donut chrome powder",
  亮片: "glitter",
  碎钻: "tiny crushed crystals",
};

const LENGTH_EN = { 短: "short", 中: "medium", 中长: "medium long", 长: "long" };

function pick(map, key, fallback) {
  if (!key) return fallback;
  for (const [k, v] of Object.entries(map)) {
    if (key === k || key.includes(k) || k.includes(key)) return v;
  }
  return fallback;
}

function buildPrompt({ color, styles, length }, variant = 0) {
  const c = pick(COLOR_EN, color, "nude");
  const st = (styles || []).map((s) => pick(STYLE_EN, s, "")).filter(Boolean);
  const styleText = st.length ? st.join(" with ") : "solid color";
  const len = pick(LENGTH_EN, length, "short");
  const angles = [
    "close-up of a woman's hand, natural soft lighting, beige background",
    "slightly angled view of a woman's hand resting on a table, warm light, minimal background",
    "top-down view of manicured nails, clean studio lighting, neutral background",
  ];
  return `Professional nail art photography, ${styleText} manicure in ${c} tone, ${len} nails, ${angles[variant % angles.length]}, realistic, high detail, natural skin, no text, no watermark`;
}

async function generateOne(prompt) {
  const r = await fetch(`${LLM_BASE}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${LLM_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "qwen-image-3.0", prompt, n: 1, size: "1024x1024" }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`生图失败 ${r.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const url = data.data?.[0]?.url;
  if (!url) throw new Error("生图没返回图片地址");
  return url;
}

/**
 * 生成 2–3 张效果图
 * @returns {Promise<Array<{url:string, prompt:string}>>}
 */
export async function generateLooks(prefs, count = 2) {
  const prompts = Array.from({ length: count }, (_, i) => buildPrompt(prefs, i));
  const results = await Promise.allSettled(prompts.map((p) => generateOne(p)));
  return results
    .map((r, i) => (r.status === "fulfilled" ? { url: r.value, prompt: prompts[i] } : null))
    .filter(Boolean);
}

// ---------- 异步任务：生图要 60 秒左右，不能让对话卡住 ----------
const tasks = new Map();
const TTL = 15 * 60 * 1000;

/** 开一个后台生成任务，立刻返回 id */
export function startLooks(prefs, count = 2) {
  const id = "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  tasks.set(id, { status: "pending", startedAt: Date.now(), images: [], prefs, count });

  generateLooks(prefs, count)
    .then((imgs) => {
      tasks.set(id, {
        status: imgs.length ? "done" : "failed",
        images: imgs,
        prefs,
        count,
        error: imgs.length ? null : "一张都没生成出来",
      });
    })
    .catch((e) => tasks.set(id, { status: "failed", images: [], prefs, count, error: String(e.message || e) }));

  for (const [k, v] of tasks) {
    if (Date.now() - (v.startedAt || 0) > TTL) tasks.delete(k);
  }
  return id;
}

/** 同一个参数重画一次，返回新任务 id */
export function retryLooks(id) {
  const t = tasks.get(id);
  if (!t?.prefs) return null;
  return startLooks(t.prefs, t.count || 2);
}

export function getLooks(id) {
  return tasks.get(id) || null;
}