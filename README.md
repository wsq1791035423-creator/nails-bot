# 美甲预约 Bot

一个给个人美甲师用的 AI 接待助手：客人发图问价、说需求推荐、查档期、登记预约，全程不用你盯着手机。

纯 Node.js 原生实现，**零第三方依赖**，不需要装包、不需要数据库。

---

## 快速开始

```bash
cd outputs/nails-bot
node src/server.mjs
```

打开 <http://127.0.0.1:8787/web/chat.html>

手机连同一个 WiFi，把 `127.0.0.1` 换成电脑的局域网 IP 也能用。

### 配置 API Key

复制 `.env.example` 为 `.env`，填进去：

```ini
DASHSCOPE_BASE_URL=https://你的端点/compatible-mode/v1
DASHSCOPE_API_KEY=sk-xxx
```

用的是阿里云百炼的 OpenAI 兼容接口。三个模型：

| 用途 | 模型 | 说明 |
| --- | --- | --- |
| 对话 | `qwen3.8-max` | 在 `src/env.mjs` 里改 |
| 识图 | `qwen3-vl-plus` | 同上 |
| 生图 | `qwen-image-3.0` | 在 `src/imagegen.mjs` 里改 |

---

## 四个页面

| 页面 | 地址 | 给谁用 |
| --- | --- | --- |
| AI 对话 | `/web/chat.html` | 客人 |
| 选款推荐 | `/web/recommend.html` | 客人自助 |
| 款式图库 | `/web/gallery.html` | 你自己核对标签 |
| 报价器 | `/web/` | 你自己算价 |

---

## 改价格

只改一个文件：`knowledge/pricing.json`

```json
{
  "base": [ ... ],      // 四个基础项目：本甲、甲膜、高位半贴、浅贴
  "styles": [ ... ],    // 款式加价项
  "fees": [ ... ],      // 断甲修补等杂项
  "rules": { ... }      // 迟到、工时
}
```

**改完必须重启服务**（`Ctrl+C` 再 `node src/server.mjs`）。

### 加价项的几种写法

```json
// 按指计价（如卡通）
{ "id": "S5", "per_finger_min": 5, "per_finger_max": 10 }

// 单指价 + 整手打包价（如魔镜粉）
{ "id": "S7", "per_finger": 2, "full_hand": 10 }

// 阶梯价 + 上限（如醋酸：10/指，4 指 36，最多 4 指）
{ "id": "S8", "per_finger": 10,
  "tiers": [{ "fingers": 4, "price": 36 }],
  "max_fingers": 4,
  "only_base": ["B1", "B4"] }
```

### 几条写死的规则

| 规则 | 写在哪 |
| --- | --- |
| 法式猫眼算猫眼，不加法式钱 | `src/vision.mjs`（猫眼+渐变同时出现时降级） |
| 醋酸最多 4 指、只能配本甲/浅贴 | `pricing.json` 的 S8 |
| 迟到 10 分钟内免费，10–30 分钟每分钟 1 元 | `pricing.json` 的 rules.late |

---

## 加款式

不要在代码里加，走这个流程：

```bash
# 1. 把图片放进 data/styles/，命名随意
# 2. 生成 Word 标注表（会给每张图预填文件名）
python scripts/make-sheet-docx.py
# 3. 在 Word 里填：甲型 / 款式名 / 主色系 / 风格 / 长度 / 显白度 …
# 4. 导入
python scripts/import-from-docx.py "C:\Users\你\Desktop\你的文件.docx"
```

导入脚本会：

- 校验标签是否在词表里
- 把图压成 900px 的 webp（放 `data/styles/web/`）
- 生成 `knowledge/03_styles.jsonl`

**注意**：导入时会**覆盖** `03_styles.jsonl`，所以 Word 文档要保留，它是唯一数据源。

### 词表在哪

`scripts/style_map.py` 里的 `TAXONOMY` 和 `STYLE_TO_SKU`，两个脚本共用。

新增做法时，两处都要加：

1. `TAXONOMY["风格"]` 里加词（不然导入会报错）
2. `STYLE_TO_SKU` 里加映射（不然算不出价）

---

## 改档期

`knowledge/schedule.json`

```json
{
  "weekly": {
    "0": [["10:00","12:00"],["13:30","20:00"]],   // 0=周日
    "1": [...],                                     // 1=周一
    ...
  },
  "exceptions": {
    "2026-11-20": { "closed": true, "note": "有事" }
  },
  "rules": {
    "min_notice_hours": 24,    // 至少提前一天
    "max_per_day": 2,          // 一天最多两单
    "slot_hours": 2.5          // 每单占多久
  },
  "orders": []                 // 订单，bot 自动写，别手改
}
```

微信里客人预约后，订单进 `orders`，状态是 `pending`（待店主确认）。

---

## 目录结构

```
nails-bot/
├── src/
│   ├── server.mjs          HTTP 服务 + 路由
│   ├── llm.mjs             模型调用 + 工具循环（核心）
│   ├── prompts.mjs         系统提示词（人设 + 价格表）
│   ├── pricing-core.mjs    报价引擎（纯函数，前后端共用）
│   ├── recommend-core.mjs  推荐打分
│   ├── style-map.mjs       做法 → 加价项映射
│   ├── vision.mjs          识图（含醋酸 few-shot 样本）
│   ├── imagegen.mjs        生图 + 异步任务
│   ├── schedule.mjs        档期 + 订单状态机
│   ├── knowledge.mjs       美甲知识检索
│   └── env.mjs             读 .env
├── knowledge/
│   ├── pricing.json        价目表（唯一价格来源）
│   ├── 03_styles.jsonl     款式库（脚本生成，别手改）
│   ├── schedule.json       档期 + 订单
│   ├── 04_faq.md           常见问答
│   ├── 05_policy.md        话术规则
│   ├── 07_beauty-knowledge.md  美甲知识（显白、甲型、趋势）
│   └── style-taxonomy.md   标签词表说明
├── scripts/                Python 工具：导入款式、生成标注表
├── data/
│   ├── styles/             原始款式图
│   ├── styles/web/         压缩后的 webp（不提交）
│   └── reference/acetate/  醋酸识别样本
└── web/                    四个页面
```

---

## 已知限制

| 限制 | 说明 |
| --- | --- |
| 甲型识别不准 | 椭圆/尖椭圆/杏仁分不清，所以改成问客人 |
| 识图会过判醋酸 | few-shot 的副作用，靠"以本人确认为准"兜底 |
| 生图要 50–60 秒 | 模型本身慢，做成异步：先回话，图后到 |
| 订单存本地文件 | 换到无持久磁盘的平台会丢，要上线得换数据库 |
| 任务在内存里 | 重启服务会丢正在生成的任务（前端会提示重画） |
| 只能在局域网访问 | 公网要域名或服务器，免费隧道都不稳定 |

---

## 提交代码

```bash
git add -A
git commit -m "改了什么"
git push
```

仓库：<https://github.com/wsq1791035423-creator/nails-bot>

`.env` 已在 `.gitignore` 里，不会被提交。换电脑要手动放一份。
