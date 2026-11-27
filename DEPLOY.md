# 部署到 Vercel

> 说明：这个 bot 原本需要「常驻进程 + 可写磁盘 + 长请求」，Vercel 三者都没有。
> 所以走 Vercel 版本时做了两处改动：**关闭生图**，**数据存到 Vercel KV**。

---

## 一、先准备数据库（Vercel KV）

1. 打开 <https://vercel.com/dashboard>
2. 顶部 **Storage** → **Create Database** → 选 **KV**（Upstash Redis）
3. 名字随便填，区域选一个近的（比如 Hong Kong / Singapore）
4. 创建后点 **Connect Project**，或者稍后在项目里 Connect

创建完，Vercel 会自动给项目注入两个环境变量：

```
KV_REST_API_URL
KV_REST_API_TOKEN
```

代码检测到这两个变量就走云端存储；没有就写本地文件。所以**不配 KV 也能部署，但预约和档期存不住**（每次请求结束就丢）。

---

## 二、配环境变量

项目 → **Settings** → **Environment Variables**，加三个：

| 变量名 | 值 |
| --- | --- |
| `DASHSCOPE_BASE_URL` | `https://你的端点/compatible-mode/v1` |
| `DASHSCOPE_API_KEY` | `sk-...` |
| `CHAT_MODEL` | `qwen3.8-max`（可选，默认就是它） |

`VISION_MODEL` 默认 `qwen3-vl-plus`，一般不用改。

---

## 三、部署

项目已经连了 GitHub，推代码就会自动部署。或者手动：

```bash
git push
```

然后到 Vercel 项目页看 **Deployments**。

---

## 四、部署后自检

打开这几个地址（把域名换成你的）：

| 地址 | 应该看到 |
| --- | --- |
| `/chat.html` | 对话页（紫白色） |
| `/web/schedule.html` | 档期管理 |
| `/web/recommend.html` | 选款推荐 |
| `/api/schedule` | 一段 JSON，含 `days` 数组 |

然后在对话页问「纯色多少钱」，能正常回话就说明 API 通了。

---

## 五、和本地版的区别

| 能力 | 本地 | Vercel |
| --- | --- | --- |
| 对话、报价、识图 | ✅ | ✅ |
| 档期查询、预约登记 | ✅ | ✅（存 KV） |
| 选款推荐（图库） | ✅ | ✅ |
| **AI 生成效果图** | ✅ | ❌ 已关闭 |
| 数据存哪 | 本地文件 | Vercel KV |

生图关掉是因为：一张图要 50–60 秒，Vercel 免费版函数上限 10 秒（本配置放宽到 30 秒），必然超时。

---

## 六、常见问题

**页面 404**
检查 Vercel 的 Build 命令是不是 `node scripts/build-public.mjs`，输出目录是不是 `public`。`vercel.json` 里已经写好了。

**能对话但预约存不住**
`KV_REST_API_URL` / `KV_REST_API_TOKEN` 没配，或者没在部署后重新部署一次（环境变量改了要重新部署才生效）。

**识图很慢或超时**
识图要传 5 张参考图，约 15 秒。如果频繁超时，把 `src/vision.mjs` 里的 `ACETATE_EXAMPLES` 和 `HANDDRAW_EXAMPLES` 各减到 1 张。

**想重新打开生图**
删掉 `src/llm.mjs` 里 `search_styles` 工具，换回 `generate_looks`，并恢复 `web/chat.html` 的 `pollLooks`。需要 Pro 版（60 秒）或换服务器。