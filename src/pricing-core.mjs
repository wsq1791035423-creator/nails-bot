// 报价核心逻辑：纯函数，不依赖文件系统，Node 和浏览器都能用。
// 数据由调用方传入（knowledge/pricing.json）。

export const FINGERS_PER_HAND = 5;
export const HANDS = 2;

const byId = (list, id) => list.find((x) => x.id === id);

/**
 * 单指款式 / 整手款式价格。
 * - 有 full_hand 且做满整手（10 指）→ 用整手打包价
 * - 有 per_finger → 单指价 × 手指数
 * - 区间价（per_finger_min/max）→ 返回区间
 * - unit === "full_only" → 必须整手，只按 full_hand
 */
export function stylePrice(style, fingers) {
  if (!style) throw new Error("未知款式");
  const n = Math.max(0, Math.min(fingers, FINGERS_PER_HAND * HANDS));

  // 超过上限就按上限算，并说明最多做几指
  if (style.max_fingers && n > style.max_fingers) {
    const capped = stylePrice(style, style.max_fingers);
    return {
      ...capped,
      detail: `${style.name}：最多做 ${style.max_fingers} 指，再多就繁琐了。${capped.detail}`,
      cappedAt: style.max_fingers,
    };
  }

  // 打包价（比如醋酸做满 4 指 36 元）
  if (style.tiers) {
    const tier = style.tiers.find((t) => t.fingers === n);
    if (tier) {
      return { min: tier.price, max: tier.price, detail: `${style.name}：${n} 指打包 ${tier.price} 元` };
    }
  }

  if (style.unit === "full_only") {
    if (n === 0) {
      return { min: 0, max: 0, detail: `${style.name}：按整手计价 ${style.full_hand} 元（需做满整手）` };
    }
    return { min: style.full_hand, max: style.full_hand, detail: `${style.name}：整手 ${style.full_hand} 元` };
  }

  if (style.per_finger_min != null) {
    return {
      min: style.per_finger_min * n,
      max: style.per_finger_max * n,
      detail: `${style.name}：${style.per_finger_min}–${style.per_finger_max} 元/指 × ${n} 指`,
    };
  }

  const per = style.per_finger ?? 0;
  if (style.full_hand != null && (n === 0 || n >= FINGERS_PER_HAND * HANDS)) {
    return { min: style.full_hand, max: style.full_hand, detail: `${style.name}：整手 ${style.full_hand} 元` };
  }
  if (per === 0) return { min: 0, max: 0, detail: `${style.name}：免费` };
  return { min: per * n, max: per * n, detail: `${style.name}：${per} 元/指 × ${n} 指` };
}

export function feePrice(fee, count = 1) {
  if (!fee) throw new Error("未知费用项");
  const unit = fee.unit === "per_finger" ? count : 1;
  return {
    min: fee.price * unit,
    max: fee.price * unit,
    detail: `${fee.name}：${fee.price} 元${fee.unit === "per_finger" ? " × " + unit + " 指" : ""}`,
  };
}

/** ≤10 分钟免费；10 < m ≤ 30 每分钟 1 元；>30 取消 */
export function lateFee(rules, minutes) {
  const { free_minutes, per_minute_fee, max_minutes, over_max_action } = rules.late;
  if (minutes <= free_minutes) {
    return { min: 0, max: 0, detail: `迟到 ${minutes} 分钟，未超过 ${free_minutes} 分钟，不收费` };
  }
  if (minutes > max_minutes) {
    return { min: 0, max: 0, cancelled: true, detail: `迟到 ${minutes} 分钟，超过 ${max_minutes} 分钟：${over_max_action}` };
  }
  const fee = Math.min(minutes, max_minutes) * per_minute_fee;
  return { min: fee, max: fee, detail: `迟到 ${minutes} 分钟，按每分钟 1 元加收 ${fee} 元` };
}

function fmtHours(min) {
  return Math.round((min / 60) * 10) / 10;
}

/**
 * 主入口
 * @param {object} pricing  pricing.json 的完整对象
 * @param {object} q
 * @param {string} q.baseId
 * @param {Array}  q.styles  [{ id:"S2", fingers:10 }]
 * @param {Array}  q.fees    [{ id:"F1", count:2 }]
 * @param {number} [q.lateMinutes]
 */
export function quote(pricing, q) {
  const base = byId(pricing.base, q.baseId);
  if (!base) throw new Error(`未知基础项目：${q.baseId}`);

  const lines = [];
  let min = base.price;
  let max = base.price;
  let duration = base.duration_min;
  const pending = [];

  lines.push({ label: base.name, amount: `¥${base.price}`, note: base.includes_color ? "含纯色/猫眼" : "不含颜色" });
  if (!base.includes_color) pending.push(base.name + " 不含颜色，需确认是否另加纯色/猫眼");
  if (base.needs_confirm) pending.push(base.confirm_note);

  // 同组做法（法式/波点/腮红/渐变/晕染）合并按「指次」计价：
  // 每满 10 指次收一个整手价（8 元）；不足 10 指次按单指价（2 元/指）。
  const groups = new Map();
  const singles = [];
  for (const s of q.styles ?? []) {
    const style = byId(pricing.styles, s.id);
    if (!style) throw new Error(`未知款式：${s.id}`);
    if (style.group) {
      const g = groups.get(style.group) ?? { style, fingers: 0, ids: [] };
      g.fingers += Math.max(0, Math.min(s.fingers ?? 0, FINGERS_PER_HAND * HANDS));
      g.ids.push(style.id);
      groups.set(style.group, g);
    } else {
      singles.push({ style, fingers: s.fingers ?? 0 });
    }
  }

  for (const [, g] of groups) {
    if (g.fingers <= 0) continue;
    const fee = g.fingers >= 10 ? g.style.full_hand * (g.fingers / 10) : g.style.per_finger * g.fingers;
    const rounded = Math.round(fee);
    min += rounded;
    max += rounded;
    duration += g.style.extra_min ?? 0;
    const names = g.ids.map((id) => byId(pricing.styles, id)?.name ?? id);
    lines.push({
      label: names.join("/"),
      amount: `¥${rounded}`,
      note: `${names.join("+")} 共 ${g.fingers} 指次`,
      skuIds: g.ids,
    });
  }

  for (const { style, fingers } of singles) {
    const p = stylePrice(style, fingers);
    min += p.min;
    max += p.max;
    duration += style.extra_min ?? 0;
    lines.push({
      label: style.name,
      amount: p.min === p.max ? `¥${p.min}` : `¥${p.min}–${p.max}`,
      note: p.detail,
      skuIds: [style.id],
    });
    if (style.needs_confirm) pending.push(style.confirm_note);
  }

  for (const f of q.fees ?? []) {
    const fee = byId(pricing.fees, f.id);
    if (!fee) throw new Error(`未知费用：${f.id}`);
    const p = feePrice(fee, f.count ?? 1);
    min += p.min;
    max += p.max;
    lines.push({ label: fee.name, amount: `¥${p.min}`, note: p.detail });
  }

  let cancelled = false;
  if (q.lateMinutes != null && q.lateMinutes > 0) {
    const l = lateFee(pricing.rules, q.lateMinutes);
    if (l.cancelled) {
      cancelled = true;
      lines.push({ label: "迟到", amount: "—", note: l.detail });
    } else if (l.min > 0) {
      min += l.min;
      max += l.max;
      lines.push({ label: "迟到加收", amount: `¥${l.min}`, note: l.detail });
    }
  }

  // 老顾客折扣：整单 ×0.95，保留两位小数，不四舍五入
  let discount = null;
  if (!cancelled && q.returning) {
    const rate = pricing.rules?.discount?.returning ?? 0.95;
    const rateLabel = pricing.rules?.discount?.name || "老顾客";
    const round2 = (n) => Math.round(n * 100) / 100;
    const fmt = (n) => (Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`);
    const beforeMin = min;
    const beforeMax = max;
    const newMin = round2(min * rate);
    const newMax = round2(max * rate);
    const savedMin = round2(beforeMin - newMin);
    const savedMax = round2(beforeMax - newMax);
    if (savedMin > 0 || savedMax > 0) {
      const zhe = Math.round(rate * 100) / 10;
      const savedText = savedMin === savedMax ? fmt(savedMin) : `${fmt(savedMin)}–${fmt(savedMax)}`;
      lines.push({
        label: `${rateLabel} ${zhe} 折`,
        amount: `−${savedText}`,
        note: `${fmt(beforeMin)}${beforeMin === beforeMax ? "" : "–" + fmt(beforeMax).slice(1)} → ${fmt(newMin)}${newMin === newMax ? "" : "–" + fmt(newMax).slice(1)}`,
      });
      min = newMin;
      max = newMax;
      discount = {
        rate,
        zhe,
        label: rateLabel,
        beforeText: fmt(beforeMin),
        afterText: fmt(newMin),
        savedText,
      };
    }
  }

  const totalText = cancelled
    ? "订单取消"
    : min === max
      ? fmtNum(min)
      : `${fmtNum(min)}–${fmtNum(max).replace("¥", "")}`;

  return {
    cancelled,
    discount,
    returning: !!q.returning,
    totalMin: cancelled ? null : min,
    totalMax: cancelled ? null : max,
    totalText,
    durationMin: duration,
    durationText: `约 ${fmtHours(duration * 1.5)}–${fmtHours(duration * 2)} 小时`,
    lines,
    pending,
  };
}

/** 金额显示：整数不带小数，小数保留两位 */
export function fmtNum(n) {
  if (n == null) return "";
  return Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`;
}