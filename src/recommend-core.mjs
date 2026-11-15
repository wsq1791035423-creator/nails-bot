// 推荐核心：纯函数，Node 和浏览器共用。
// 输入：价位表 + 款式库 + 用户偏好 → 输出 3 款（含真实报价和理由）

import { quote } from "./pricing-core.mjs";

// 报价基准一律用「本甲」。延长（甲膜/高位半贴/浅贴）不自动选，
// 由客人自己挑，价格在 extendOptions 里另列。
const DEFAULT_BASE = "B1";

export function baseForStyle() {
  return DEFAULT_BASE;
}

/** 四种做法的对比，给客人自己选 */
export function extendOptions(pricing) {
  return pricing.base.map((b) => ({
    id: b.id,
    name: b.name,
    price: b.price,
    suitable: b.suitable,
    pros: b.pros,
    cons: b.cons,
  }));
}

// 这些加价项没有整手打包价，是按指计的（报「起价」+ 单价，不报整手总价）
const PER_FINGER_SKUS = new Set(["S4", "S5", "S6"]);

/** 按「能确定的部分」估算报价；按指计价的款式单独列出单价 */
export function priceForStyle(pricing, style) {
  const baseId = baseForStyle();
  const ids = style.style_ids || [];
  // 名字里写了「全手 / 整手」的，按 10 指算（否则按指另计）
  const fullHand = /全手|整手/.test(style.name || "");

  const fixed = ids.filter((id) => fullHand || !PER_FINGER_SKUS.has(id));
  const perFinger = fullHand ? [] : ids.filter((id) => PER_FINGER_SKUS.has(id));

  // 同一组的做法（法式/波点/腮红…）在推荐里默认「搭配着做满整手」，只传一次 10 指
  const seenGroups = new Set();
  const fixedDedup = [];
  for (const id of fixed) {
    const sku = pricing.styles.find((s) => s.id === id);
    if (sku?.group) {
      if (seenGroups.has(sku.group)) continue;
      seenGroups.add(sku.group);
    }
    fixedDedup.push(id);
  }

  const result = quote(pricing, {
    baseId,
    styles: fixedDedup.map((id) => ({ id, fingers: 10 })),
  });

  // 同组做法（法式+波点+腮红…）可能各自做满整手，价格会叠加 → 给出的上限
  let totalMax = result.totalMax;
  if (fixed.length > fixedDedup.length) {
    const rMax = quote(pricing, {
      baseId,
      styles: fixed.map((id) => ({ id, fingers: 10 })),
    });
    totalMax = rMax.totalMax;
  }

  // 明细里用「实际做法」代替打包类名
  if (result.lines && style.style_labels) {
    for (const line of result.lines) {
      if (!line.skuIds?.length) continue;
      const labels = [...new Set(line.skuIds.flatMap((id) => style.style_labels[id] || []))];
      if (labels.length) line.label = labels.join("/");
    }
  }

  const extras = perFinger.map((id) => {
    const sku = pricing.styles.find((s) => s.id === id);
    if (!sku) return "";
    const min = sku.per_finger_min ?? sku.per_finger;
    const max = sku.per_finger_max ?? sku.per_finger;
    const range = min == null ? "" : min === max ? `${min}` : `${min}–${max}`;
    return `${sku.name} ${range} 元/指`;
  }).filter(Boolean);

  return {
    ...result,
    totalMax,
    totalText: result.cancelled
      ? "订单取消"
      : result.totalMin === totalMax
        ? `¥${result.totalMin}`
        : `¥${result.totalMin}–${totalMax}`,
    baseId,
    perFinger,
    extraText: extras.join("；"),
    isFrom: perFinger.length > 0,
    extendOptions: extendOptions(pricing),
  };
}

function scoreOf(pricing, style, price, prefs) {
  const t = style.tags || {};
  let s = 0;
  const reasons = [];

  // 肤色
  if (prefs.skin === "黄黑") {
    if (t.skin_effect === "显白") { s += 5; reasons.push("显白"); }
    else if (t.skin_effect === "挑肤色") { s -= 4; }
  } else if (prefs.skin === "冷白") {
    if (t.skin_effect !== "挑肤色") { s += 2; }
  }

  // 甲长
  if (prefs.length) {
    if (t.length === prefs.length) { s += 4; reasons.push(`${prefs.length}甲`); }
    else if (t.length === "延长" && prefs.length === "短") { s -= 3; }
  }

  // 场合
  if (prefs.occasion && (t.occasion || []).includes(prefs.occasion)) {
    s += 3; reasons.push(prefs.occasion);
  }

  // 风格关键词（用户明确说出口的，权重最高）
  if (prefs.keywords?.length) {
    const norm = (s) => String(s).replace(/[款式风格的做法花型们]/g, "").trim();
    const hit = prefs.keywords.filter((raw) => {
      const k = norm(raw);
      if (!k) return false;
      return (
        (t.style || []).some((x) => x.includes(k) || k.includes(x)) ||
        (t.color || "").includes(k) ||
        (style.name || "").includes(k)
      );
    });
    if (hit.length) { s += hit.length * 8; reasons.push(hit.join("、")); }
    else { s -= 6; }
  }

  // 想不想延长
  if (prefs.wantExtend === false && t.extend !== "不需要") s -= 3;
  if (prefs.wantExtend === true && t.extend !== "不需要") { s += 2; }

  // 预算：只惩罚超支，不奖励「便宜」
  if (prefs.budget) {
    if (price.totalMin > prefs.budget * 1.4) s -= 6;
    else if (price.totalMin > prefs.budget) s -= 2;
  }

  // 极轻微的性价比倾向（同分时优先便宜一点，不影响意图判断）
  s += Math.max(0, Math.min(0.5, (120 - (price.totalMin ?? 120)) / 140));

  return { s, reasons };
}

function reasonText(style, reasons, prefs) {
  const t = style.tags || {};
  const bits = [...new Set(reasons)];
  if (!bits.length) {
    bits.push(t.skin_effect === "显白" ? "稳妥不出错" : "百搭");
  }
  const tail = t.extend && t.extend !== "不需要" ? "，这款通常要做延长" : "";
  return bits.join(" · ") + tail;
}

export function recommend(pricing, styles, prefs, n = 3) {
  const scored = styles
    .map((st) => {
      const price = priceForStyle(pricing, st);
      const { s, reasons } = scoreOf(pricing, st, price, prefs);
      return { style: st, price, score: s, reasons };
    })
    .sort((a, b) => b.score - a.score);

  // 简单去重：同色系 + 同主风格各最多一款，避免三张图看着一样
  const picked = [];
  for (const c of scored) {
    if (picked.length >= n) break;
    const dup = picked.some((p) => {
      const a = p.style.tags || {};
      const b = c.style.tags || {};
      const overlapStyles = (a.style || []).filter((x) => (b.style || []).includes(x)).length;
      return overlapStyles >= 2 && a.color === b.color;
    });
    if (dup) continue;
    picked.push(c);
  }
  // 不够就按分数补
  for (const c of scored) {
    if (picked.length >= n) break;
    if (!picked.includes(c)) picked.push(c);
  }

  // 用户点名要的风格，必须至少出现一款
  const hitsKeyword = (c) =>
    prefs.keywords?.length &&
    prefs.keywords.some(
      (k) => (c.style.tags.style || []).some((x) => x.includes(k)) || (c.style.tags.color || "").includes(k)
    );
  if (prefs.keywords?.length && picked.length && !picked.some(hitsKeyword)) {
    const best = scored.find(hitsKeyword);
    if (best) picked[picked.length - 1] = best;
  }

  return picked.map((c) => ({
    id: c.style.id,
    name: c.style.name,
    img: c.style.img,
    tags: c.style.tags,
    priceText: c.price.totalText + (c.price.isFrom ? " 起" : ""),
    extraText: c.price.extraText,
    isFrom: c.price.isFrom,
    priceMin: c.price.totalMin,
    priceMax: c.price.totalMax,
    overBudget: prefs.budget ? c.price.totalMin > prefs.budget : false,
    durationText: c.price.durationText,
    baseId: c.price.baseId,
    lines: c.price.lines,
    priceConfirm: !!c.style.price_confirm,
    score: Math.round(c.score * 10) / 10,
    reason: reasonText(c.style, c.reasons, prefs),
  }));
}