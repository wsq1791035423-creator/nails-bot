// LLM 调用 + 工具循环
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM_BASE, LLM_KEY, MODELS } from "./env.mjs";
import { recommend, priceForStyle } from "./recommend-core.mjs";
import { systemPrompt } from "./prompts.mjs";
import { checkSlots, bookSlot, upcoming, todayStr, updateOrder, findOrders, listOrders } from "./schedule.mjs";
import { analyzeImage } from "./vision.mjs";
import { startLooks, getLooks } from "./imagegen.mjs";
import { beautyContext } from "./knowledge.mjs";

function visionContext(v) {
  if (!v.ok) {
    return `【客人刚发了一张图，但没识别出有效美甲信息：${v.error || v.reply || "不是美甲图"}】
请让客人重发一张清晰的、能看清甲面的图，或者用文字描述想看什么。绝对不要编造图片内容。`;
  }
  const a = v.analysis || {};

  return `【客人刚发来一张图，视觉识别结果（只作参考）】
类型：${a.kind || "未知"}
主色：${a.color || "没看出"}
做法：${(a.styles || []).join("、") || "纯色"}
甲长：${a.length || "没看出"}
甲型：${a.shape || "看不清"}（仅供参考，不要当结论）
甲床：${a.nail_bed || "看不清"}
置信度：${a.confidence ?? "?"}

【按价目表算好的报价 —— 直接引用，不要自己重算】
总价：${v.quote.total}
时长：${v.quote.duration}
明细：${v.quote.lines.join("；")}
${v.quote.extra ? `另计：${v.quote.extra}` : ""}

请基于这个结果回答：先说能不能做、大概多少钱，再说一句"我看出是 X+Y，如果不是你告诉我"让客人确认。
${(a.styles || []).includes("醋酸") ? "注意：这是醋酸款，只能配本甲（39）或浅贴延长（89）。甲膜和高位半贴撑不住，不要推荐这两档。\n" : ""}
甲型识别经常不准，不要断言"你的甲型是 X"。回复末尾顺便问一句："你想做什么甲型？方圆 / 椭圆 / 杏仁 / 尖。"
不要说"库里有类似的款""我们库里有 XX"这种话——客人不关心库里有没有，只关心能不能做、多少钱。
手绘、雕花、复杂图案这类图片看不准，回复末尾加一句"具体做法和价格以本人确认为准"。
注意：上面这个价是按「本甲」算的，不含延长。回答时补一句——想要更长可以选延长
（甲膜 65 / 高位半贴 69 / 浅贴 89），三种的优缺点让她自己挑，不要替她决定。
如果明细里有「另计」项（比如醋酸、堆钻、卡通 5–10 元/指），必须原样说出来，不能只报起价。
不要重新报价，不要描述识别结果里没有的细节。`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "pricing.json"), "utf8"));
const STYLES = fs
  .readFileSync(path.join(ROOT, "knowledge", "03_styles.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "quote_style",
      description:
        "查某一款的具体报价（明细 + 合计 + 时长）。style_id 来自客人发图后匹配到的款式，或客人点名要的款。客人说是老顾客时 returning 传 true。",
      parameters: {
        type: "object",
        properties: {
          style_id: { type: "string", description: "款式 id，如 ST001" },
          returning: { type: "boolean", description: "是不是老顾客（回头客），是的话打 95 折" },
        },
        required: ["style_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_services",
      description:
        "列出四个基础项目的名称和价格（本甲、甲膜延长、高位半贴、浅贴延长）。客人问\"纯色多少钱\"时先调这个。客人是老顾客就传 returning=true。",
      parameters: {
        type: "object",
        properties: {
          returning: { type: "boolean", description: "是不是老顾客（回头客），是的话打 95 折" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_slots",
      description:
        "查档期。传 date（YYYY-MM-DD）查某天；不传 date 就返回未来 7 天哪天空。客人问\"周六有空吗\"\"这周还有位置吗\"时调用。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD，比如 2026-11-15。不传则查未来 7 天" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_slot",
      description:
        "客人明确要约时调用。调用前必须问清四件事：哪天、几点、怎么称呼、联系方式（微信或手机）。预约是意向，不是最终确认。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          start: { type: "string", description: "开始时间 HH:MM，比如 14:00" },
          name: { type: "string", description: "客人怎么称呼" },
          contact: { type: "string", description: "微信或手机号" },
          style: { type: "string", description: "想做的款式名" },
          shape: { type: "string", description: "甲型，比如 方圆/椭圆/杏仁/尖" },
          note: { type: "string", description: "备注：过敏、特殊要求、参考图描述" },
          hours: { type: "number", description: "预计做几个小时，默认 2.5" },
        },
        required: ["date", "start", "name", "contact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "manage_order",
      description:
        "改约或取消预约。客人说「改到周六」「取消吧」时调用。用 orderId 或 contact 定位订单；不知道就先问昵称或微信。",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "订单号，比如 O001" },
          contact: { type: "string", description: "客人的微信或手机号" },
          action: { type: "string", enum: ["cancel", "reschedule"], description: "取消或改约" },
          newDate: { type: "string", description: "改约的新日期 YYYY-MM-DD" },
          newStart: { type: "string", description: "改约的新开始时间 HH:MM" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_orders",
      description: "查预约记录。店主问「明天有几个」「这周排了几单」时用。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD，不传则列全部" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_looks",
      description:
        "根据客人的颜色和风格偏好，生成 2 张美甲效果图给她看。调用前必须已经问清颜色和风格。生成要 1 分钟左右，调用后要告诉客人正在画。",
      parameters: {
        type: "object",
        properties: {
          color: { type: "string", description: "主色，比如 裸色、粉、红、蓝绿、黑、白、紫、银" },
          styles: {
            type: "array",
            items: { type: "string" },
            description: "做法，比如 法式、猫眼、波点、手绘、卡通、贴钻、渐变、晕染、腮红、魔镜粉",
          },
          length: { type: "string", enum: ["短", "中", "中长", "长"], description: "甲长" },
        },
        required: ["color"],
      },
    },
  },
];

function runTool(name, args) {
  if (name === "search_styles") {
    const prefs = {
      skin: args.skin,
      length: args.length,
      occasion: args.occasion,
      budget: args.budget,
      keywords: args.keywords,
    };
    const res = recommend(PRICING, STYLES, prefs, 3);
    const kw = args.keywords || [];
    const norm = (s) => String(s).replace(/[款式风格的做法花型]/g, "").trim();
    // 有没有真的命中客人点名的做法/颜色（没命中就别硬凑）
    const matchedCount = kw.length
      ? res.filter((r) =>
          kw.some((k) => {
            const kk = norm(k);
            if (!kk) return false;
            return (
              r.name.includes(kk) ||
              (r.tags.style || []).some((x) => x.includes(kk) || kk.includes(x)) ||
              (r.tags.color || "").includes(kk)
            );
          })
        ).length
      : res.length;

    return {
      cards: res,
      matchedCount,
      hint:
        matchedCount === 0
          ? "上面这 3 款都不含客人要的做法。回答时直接说：库里没有现成的这款，但这个做法完全能做，加价 5–10 元/指。"
          : undefined,
      summary: res
        .map(
          (r) =>
            `${r.name}（${r.id}）：${r.priceText}${r.extraText ? `，另计 ${r.extraText}` : ""}，${r.durationText}，理由：${r.reason}`
        )
        .join("\n"),
    };
  }

  if (name === "quote_style") {
    const style = STYLES.find((s) => s.id === args.style_id);
    if (!style) return { error: `没有 id 为 ${args.style_id} 的款式` };
    const p = priceForStyle(PRICING, style, { returning: !!args.returning });
    return {
      style_id: style.id,
      name: style.name,
      total: p.totalText,
      duration: p.durationText,
      lines: p.lines.map((l) => `${l.label}：${l.amount}`),
      extra: p.extraText || null,
      discount: p.discount ? `${p.discount.label} ${p.discount.zhe} 折，省 ${p.discount.savedText}` : null,
    };
  }

  if (name === "list_services") {
    const rate = PRICING.rules?.discount?.returning ?? 0.95;
    const returning = !!args.returning;
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      services: PRICING.base.map((b) => {
        const price = returning ? r2(b.price * rate) : b.price;
        const note = returning ? `原价 ${b.price}，老顾客 ${b.price} → ${price}` : "";
        return `${b.id} ${b.name} ¥${price}（${b.duration_min} 分钟标准工时）${note ? "｜" + note : ""}`;
      }),
      returning,
      note: "所有基础价都含：卸本甲（免费）+ 去死皮 + 湿处理 + 纯色/猫眼",
    };
  }

  if (name === "check_slots") {
    if (args.date) return checkSlots(args.date);
    return { upcoming: upcoming(7), today: todayStr() };
  }

  if (name === "book_slot") {
    return bookSlot(args);
  }

  if (name === "manage_order") {
    return updateOrder(args);
  }

  if (name === "list_orders") {
    return { orders: listOrders(args), total: listOrders(args).length };
  }

  if (name === "generate_looks") {
    const taskId = startLooks({ color: args.color, styles: args.styles, length: args.length }, 2);
    return {
      task_id: taskId,
      note: "已经在画了，大约 1 分钟出图，稍后会自动发给客人。现在先跟客人说一句正在画。",
      looksTask: taskId,
    };
  }

  return { error: `未知工具 ${name}` };
}

async function callLLM(messages, tools) {
  const r = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${LLM_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELS.chat,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`LLM ${r.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

/**
 * 跑一轮对话（含工具调用）
 * @param {Array} history [{role:"user"|"assistant", content}]
 */
export async function chat(history, image) {
  let vision = null;
  if (image?.data) {
    try {
      vision = await analyzeImage(image.data, image.mime);
    } catch (e) {
      vision = { ok: false, error: String(e.message || e) };
    }
  }

  const messages = [{ role: "system", content: systemPrompt(PRICING) }, ...history];
  if (vision) messages.push({ role: "system", content: visionContext(vision) });

  const lastUser = [...history].reverse().find((h) => h.role === "user");
  const userText = lastUser?.content || "";

  // 代码兜底：客人只说"帮我推荐/随便看看"时，模型经常反问而不搜。
  // 这里先替它搜好，再把结果塞进上下文，保证一定有卡片出来。
  let preCards = null;
  const alreadyCarded = history.some((h) => h.role === "assistant" && h.content.includes("这一轮推荐的款式"));
  const wantsRecommend =
    !vision &&
    !alreadyCarded &&
    userText.length < 20 &&
    /推荐|看看|都行|随便|没想好|有什么好|不知道做/.test(userText);

  if (wantsRecommend) {
    messages.push({
      role: "system",
      content: `客人说"${userText}"，想要推荐，但她还没给任何参考。
不要推荐具体款式，也不要翻现有的款。
像专业美甲师那样先聊两句，把这几件事一次问清（合并成一段自然的话，别列清单）：
① 平时穿搭偏黑白灰 / 暖色 / 冷色？
② 这次想要日常低调，还是想有点存在感（约会/拍照/见人）？
③ 现在甲长什么样（短/中/长）？
等她回答后，再用 generate_looks 给她画 2 张效果图。`,
    });
  }

  // 推荐流程里客人答了偏好 → 必须画图
  const inRecommendFlow = history.some(
    (h) =>
      h.role === "assistant" &&
      /黑白灰|暖色系|冷色系|日常低调|存在感|甲长大概|帮你画|画\s*2\s*款|画两|画2张/.test(h.content || "")
  );
  if (inRecommendFlow && !wantsRecommend && !vision && !alreadyCarded) {
    messages.push({
      role: "system",
      content: `客人已经在推荐流程里回答了偏好："${userText}"。
现在必须调用 generate_looks 给她画 2 张效果图，把颜色（color）、做法（styles）、甲长（length）填进参数。
不许只描述"我给你画了两款"然后不调用工具——不调用客人就什么都看不到。
也不要拿现成的款糊弄。`,
    });
  }

  // 客人已经提到蹭粉：只确认几只手指，不许问"要不要加"
  if (/蹭粉|海莉粉|魔镜粉/.test(userText)) {
    messages.push({
      role: "system",
      content: '客人已经提到蹭粉/海莉粉了。不要问"要不要加"，只问"做几个手指"，并说明 2 元/指、整手 10 元。',
    });
  }

  // 美甲知识：按关键词注入，不整篇塞
  const beauty = beautyContext(userText);
  if (beauty) {
    messages.push({
      role: "system",
      content: `【参考知识（公开资料整理，作答时可引用，不要照抄整段）】\n${beauty}\n\n用这些知识回答，但要简短，别把表格整个念给客人。`,
    });
  }

  let cards = preCards;
  let looksTask = null;
  const toolLog = [];

  // 代码兜底：客人发来的参考图如果没识别出蹭粉，追问一句「有蹭粉吗」——
// 是确认规格，不是推销，所以不能说「要不要加」。
  const haileyRe = /蹭粉|海莉粉|魔镜粉/;
  const visionStyles = vision?.analysis?.styles || [];
  const visionHasHailey = visionStyles.some((s) => haileyRe.test(s));
  const shouldAskHailey = !!vision?.ok && !visionHasHailey;

  const finalize = (res) => {
    // 图片识别的款式细节不可靠（手绘、雕花尤其），一律让本人兜底
    if (vision?.ok && res.reply && !/本人确认|人工确认/.test(res.reply)) {
      res.reply = res.reply.trimEnd() + "\n\n（手绘、雕花这类细节图片看不全，具体做法和价格以本人确认为准。）";
    }
    if (shouldAskHailey && res.reply && !haileyRe.test(res.reply)) {
      res.reply = res.reply.trimEnd() + "\n\n对了，这个款式里有蹭粉（海莉粉）吗？有的话做几个手指？";
    }
    return res;
  };

  for (let round = 0; round < 4; round++) {
    const data = await callLLM(messages, TOOLS);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("LLM 返回为空");

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      return finalize({ reply: msg.content || "", cards, toolLog, vision, looks: looksTask });
    }

    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });
    for (const tc of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      let result;
      try {
        result = runTool(tc.function.name, args);
      } catch (e) {
        result = { error: String(e.message || e) };
      }
      if (result?.cards) cards = result.cards;
      if (result?.looksTask) looksTask = result.looksTask;
      toolLog.push({ name: tc.function.name, args, ok: !result?.error });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  return finalize({ reply: "我这边有点卡住，稍等再试一次好吗？", cards, toolLog, vision });
}