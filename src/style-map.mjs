// 做法 → 加价项映射（与 scripts/style_map.py 保持一致）
export const STYLE_TO_SKU = {
  // 基础价里已含
  纯色: [],
  猫眼: [],
  碎钻: [],
  // S2 组（法式/波点/腮红/渐变/晕染，共用指次）
  法式: ["S2F"],
  波点: ["S2D"],
  腮红: ["S2B"],
  渐变: ["S2G"],
  晕染: ["S2Y"],
  亮片: ["S2G"],
  // S3 极简手绘
  手绘: ["S3"],
  // S5 卡通
  卡通: ["S5"],
  // S6 款式钻/堆钻/浮雕
  贴钻: ["S6"],
  堆钻: ["S6"],
  浮雕: ["S6"],
  拼钻: ["S6"],
  雕花: ["S6"],
  钻球: ["S6"],
  // S8 复杂晕染（醋酸）：10 元/指
  醋酸: ["S8"],
  // S7 魔镜粉 / 海莉粉
  魔镜粉: ["S7"],
  海莉粉: ["S7"],
  蹭粉: ["S7"],
  撒粉: ["S7"],
};

// 区间价（5–10 元/指），报价时要标明「另计」
export const PER_FINGER_SKUS = new Set(["S4", "S5", "S6", "S8"]);

export function skuIdsFor(styles = []) {
  return [...new Set(styles.flatMap((s) => STYLE_TO_SKU[s] || []))];
}

export function styleLabelsFor(styles = []) {
  const map = {};
  for (const s of styles) {
    for (const sku of STYLE_TO_SKU[s] || []) {
      (map[sku] ||= []).push(s);
    }
  }
  return map;
}