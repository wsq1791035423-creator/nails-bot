# 部署到 Vercel（已完成）

> 线上地址：<https://nails-bot-nine.vercel.app>
> 实际使用的存储：**Upstash for Redis（Free 套餐）**，环境变量前缀设为 `KV`。
> 数据在 Vercel KV 里，本地文件只在本地开发时用。

---

## 当前架构

| 部分 | 怎么跑的 |
| --- | --- |
| 页面（web/*.html） | 提交在 `public/` 里，由 Vercel CDN 直接托管 |
| API（/api/*） | `api/index.js` 函数，内部转给 `src/app.mjs` |
| 数据（订单、档期） | Vercel KV（Upstash Redis），走 REST 接口，零依赖 |
| 生图 | **已关闭**（Vercel 函数 30 秒上限，生图需 60 秒） |

`vercel.json` 的关键配置：

```json
{
  "outputDirectory": "public",
  "functions": { "api/index.js": { "maxDuration": 30, "includeFiles": "{web/**,knowledge/**,data/styles/web/**,data/reference/**}" } },
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index.js?__path=$1" }]
}
```

`?__path=$1` 是必须的：Vercel 重写会把 URL 换成目标路径，原路径得靠查询参数带进函数。

---

## 改完代码怎么发布

```bash
git add -A
git commit -m "改了什么"
git push
```

Vercel 会自动部署，约 1 分钟。

**注意**：改了 `web/`、`knowledge/`、`data/styles/` 之后，要先跑一次

```bash
node scripts/build-public.mjs
```

把内容同步到 `public/`，否则线上还是旧文件。

---

## 环境变量（Vercel 项目里配好的）

| 变量 | 用途 |
| --- | --- |
| `DASHSCOPE_BASE_URL` | 模型端点 |
| `DASHSCOPE_API_KEY` | 模型密钥 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 存储（装 Upstash 时自动注入） |

---

## 本地开发

```bash
node src/server.mjs
```

没有 KV 环境变量时自动写本地文件（`data/orders.json`、`knowledge/schedule.json`），和线上互不影响。

---

## 出问题时

**页面 404**：忘了跑 `build-public.mjs`，`public/` 里没有新文件。

**预约报 EROFS**：KV 环境变量没生效，重新部署一次。

**识图超时**：把 `src/vision.mjs` 里的 `ACETATE_EXAMPLES`、`HANDDRAW_EXAMPLES` 各减到 1 张。