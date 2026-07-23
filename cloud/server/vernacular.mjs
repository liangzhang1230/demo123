/* ============================================================
   C11 · 白话原语（v5.1 §10.10 / §12 C11 行；🔴 A-C07 出参审计）
   定位：服务端白话装配器。判定引擎（domain/C1）只出 {light, code, vars}；
   静态文案渲染本属表现层，这里提供服务端统一装配出口，供早报/插卡/API 复用。
   架构（§10.10 AI 引擎可插拔）：
     - renderTalk(code, vars)      静态模板渲染（唯一兜底真相，模板逐字内置自五板块话术库，
                                   引用锁 L-1：任何字与板块规格不一致视为笔误，以板块为准）
     - aiPolish(client, code, vars, opts)
                                   可插拔 AI 客户端润色：client = {name, complete(prompt)->Promise<string>}
                                   🔴 A-C07 出参审计：prompt 只含 sanitizeForAI 白名单值
                                   （数值/百分比/枚举码/日期），name/phone/clientName 等标识
                                   字段剥离为 '员工A' 类占位；组装后机检 prompt 不含被剥原值；
                                   client 为 null / complete 抛错 / 超时 → 静态回退 renderTalk
                                   （断开 AI 服务 → 全系统白话位静态回退零缺字）
     - talkFor(db, ctx, {module, code, vars, aiClient})
                                   统一出口：渲染 + 事件留痕（payload 零客户明细）
   🔴 零真实时钟调用（公约 C-14）；超时用定时器竞速，不读时钟。
   ============================================================ */
import { logEvent } from './writes.mjs';

/* ============================================================
   模板表：五板块话术库代表性话术码（每板块 ≥3 条，逐字内置；{var} 占位）
   出处：1号件五 W 系 / 2号件五 Z 系 / 3号件五 S 系 / 4号件五 L 系 / 5号件五 Y 系
   ============================================================ */
export const TALK_TEMPLATES = {
  dingjia: {
    'W-05': '『🔴 全链提成占目标毛利 {burdenPct}，超过 35% 红线——团队长大这套方案会把你撑穿。（35% 毛利 ≈ 当毛利率约 25–30% 时的营收薪酬上限）』',
    'W-07': '『你以为招 {S1} 个，六步链算出要招 {S6} 个——差的 {diff} 个，就是"人头×配额"高估产能的代价。且最晚 {deadline} 必须开招，否则明年目标在今天就已经完不成了。』',
    'W-14': '『今年已注定漏损 ≈ {total}：流失总账 {annual} + 产能高估暴露 {expose}。这两笔钱不在任何报表上——它们是"按老算法办事"的价格。』',
  },
  zhaoren: {
    'Z-01': '『你以为再招 {naive} 个，七步链算出要招 {true} 个——你的产能高估率 {ovr}。📎 全球基准：人头×配额会高估产能 30%–55%。』',
    'Z-02': '『最晚开始招聘日是 {deadline}，你已经晚了 {late} 天。按现有编制与爬坡曲线，今年 {target} 的目标，数学上已不可能。』',
    'Z-03': '『你要招的不是 {true} 个销售，是 {true} 个销售加 {mgrGap} 个主管——目标编制 {heads} 人，现状每人每周只分到 {min} 分钟纯辅导（有效地板是 30 分钟）。』',
  },
  suanzhang: {
    /* S-02 = 核弹三句杀手（三句一码，逐字同源） */
    'S-02': '①『你的销冠 {A}，业绩第一（{v1}）。但他拿的是 {n1} 条线索——平均份额的 {x} 倍。归一化后，他排第 {r1}。』②『你的垫底 {J}，业绩最差（{v2}），你正准备淘汰他。但他只拿到 {n2} 条线索，单位线索产出是销冠的 {y} 倍。归一化后，他是全队第一。你正在淘汰你最强的人。』③『团队失衡率 {imb}（全球约六成）。📎 仅重新划分线索，销售额预计提升 2%–7%——不增加任何人手。按你 {g} 的月毛利：每月 ¥{lo}–{hi}，每年 ¥{ylo}–{yhi}。』',
    'S-03': '『UER 是一个信号，不是一个结论。它告诉你"这里有事情发生"，不告诉你"发生了什么事"。要弄清楚原因，请看三个分项，或用 M31 系数实验室做 A/B。』',
    'S-04': '『⚠️ 这是相关性，不是因果。有产权协议的人 UER 更高，可能因为产权，也可能因为你本来就把产权给了更强的人。要证明因果，请用 M31 做一次随机对照实验。[ 启动实验 5：M28 产权化带教 vs 一次性奖金 ]』',
  },
  liuren: {
    'L-10a': '『拟发 {amt} 低于他去年同期实收 {hist}——这不是发钱，是宣战。』',
    'L-10b': '『拟发 {amt} 高于去年（{hist}），但低于他心里的"应得数"（{trend}，按贡献增长 {g} 推算）——涨了钱，买到怨气。📎 Mas, QJE 2006：工资上涨但低于参照点，绩效照样下滑。参照点才是计价器。』',
    'L-10c': '『拟发 {amt} ≥ 趋势参照点 {trend}。这笔钱他会记成"被看见"。』',
    'L-10d': '『发放沟通铁律：公开"规则"（这笔钱怎么算出来的公式），永不公开"数字"（别人拿多少）。📎 Card et al., AER 2012：公开工资只做减法——伤人的是名次，不是金额。』',
  },
  yuren: {
    'Y-09': '『你的老手（司龄>2 年）人均确认辅导 {a}h/月，全队人均 {b}h——老手辅导比 {r}。辅导资源天然流向新人，老手被默认"不需要"，而他们的技能衰减无人监测、经验红利正在吃老本。✅ 建议：每季度一次老手专项复盘（走回执），话题=他最近 90 天转化率变化最大的环节。』',
    'Y-10': '『稳定输出者要的不是奖，是"被看见"。发奖会挤出他；不看见会失去他。静默认可，是唯一的中间路径。』',
    /* Y-11 = 汰前拦截三连（三句一码，逐字同源） */
    'Y-11': '①『他一个月只拿到 {n} 条线索。这不是他不干活，这是你没给他饭吃。』②『他前两周只练了 {p} 次（基准 50–100）。你还没给他机会，就要淘汰他。』③『他入职 {d} 天，一次被确认的辅导都没有。你在淘汰一个没人教过的人。』',
  },
};

/* code → board 反查表（code 全局唯一） */
const CODE_BOARD = {};
for (const [board, m] of Object.entries(TALK_TEMPLATES))
  for (const code of Object.keys(m)) CODE_BOARD[code] = board;

const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * 静态模板渲染（白话位的兜底真相）：{var} 注入；模板缺 var → 显 '—' 不缺字。
 * 返回 { code, board, text, missingVars }；未知 code → throw {code:'UNKNOWN_TALK_CODE'}。
 */
export function renderTalk(code, vars = {}) {
  const board = CODE_BOARD[code];
  if (!board) {
    const e = new Error(`未知话术码：${code}`);
    e.code = 'UNKNOWN_TALK_CODE';
    throw e;
  }
  const missingVars = [];
  const text = TALK_TEMPLATES[board][code].replace(PLACEHOLDER_RE, (_, name) => {
    const v = vars[name];
    if (v == null || v === '') { missingVars.push(name); return '—'; }   // 缺 var → '—' 不缺字
    return String(v);
  });
  return { code, board, text, missingVars };
}

/* ============================================================
   🔴 A-C07 出参审计：sanitizeForAI —— 白名单只放行、标识字段剥离
   ============================================================ */
/* 标识字段键名（黑名单，命中即剥离——白名单之前先判） */
const IDENTITY_KEY_RE = /(name|phone|mobile|tel|client|customer|contact|wechat|weixin|idcard|address|addr|email)/i;
/* 中国大陆手机号形（键名遮不住时按值兜底剥离） */
const PHONE_RE = /^1[3-9]\d{9}$/;
/* 白名单值形：数值 / 百分比 / 金额量词 / 日期 / 枚举码 / 布尔 */
const WHITELIST_RES = [
  /^[+-]?[\d.,]+%?$/,                                    // 数值 / 百分比（60.0% / 1,950,000）
  /^[¥￥$]?[\d.,]+(万|亿|元|天|人|条|次|个|倍|分钟|小时|h|x|X)?$/, // 金额/量词数值
  /^\d{4}-\d{2}(-\d{2})?$/,                              // YYYY-MM / YYYY-MM-DD
  /^[a-z][a-z0-9_]{0,31}$/i,                             // 枚举码（short / tier1 / margin_based…）
];

/**
 * 出参脱敏（A-C07 唯一口径）：返回 { vars, stripped }。
 * - 键名命中标识黑名单 → 剥离（脱敏为 '员工A' 类占位）
 * - 值为手机号形 → 剥离
 * - 其余仅当命中白名单值形（数值/百分比/枚举码/日期/布尔）才放行；
 *   放不进白名单的（如中文姓名、自由文本）一律剥离——只出脱敏数值与模板变量。
 */
export function sanitizeForAI(vars = {}) {
  const out = {};
  const stripped = [];
  let seq = 0;
  const placeholder = () => `员工${String.fromCharCode(65 + (seq++ % 26))}`;   // 员工A / 员工B / …
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) { out[k] = null; continue; }
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; continue; }
    if (typeof v === 'boolean') { out[k] = v; continue; }
    const s = String(v);
    if (IDENTITY_KEY_RE.test(k) || PHONE_RE.test(s) || !WHITELIST_RES.some(re => re.test(s))) {
      const ph = placeholder();
      out[k] = ph;
      stripped.push({ key: k, original: s, placeholder: ph });
      continue;
    }
    out[k] = s;
  }
  return { vars: out, stripped };
}

/* 定时器竞速（不读时钟——零真实时钟调用，公约 C-14） */
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('ai_timeout'), { code: 'AI_TIMEOUT' })), ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); });
  });
}

/**
 * 可插拔 AI 润色：client = {name, complete(prompt)->Promise<string>}。
 * 🔴 失败即静态回退（A-C07 后半句）：client 缺席 / complete 抛错 / 超时 / 返回空 /
 *    prompt 机检不过 → renderTalk 静态文案，永不缺字。
 * 返回 { text, source:'static'|'ai', code, board, prompt?, sanitized?, fallbackReason? }。
 */
export async function aiPolish(client, code, vars = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const statics = renderTalk(code, vars);                     // 兜底先算好：任何失败路径直接用
  if (!client || typeof client.complete !== 'function')
    return { text: statics.text, source: 'static', code, board: statics.board, fallbackReason: 'no_ai_client' };

  const { vars: safeVars, stripped } = sanitizeForAI(vars);
  const safeText = renderTalk(code, safeVars).text;           // 脱敏后的静态文案进 prompt
  const prompt = [
    '你是销售管理系统的白话润色器。请将下面这句系统话术改写得更口语，',
    '不得改变其中任何数字、百分比与结论，不得添加新的事实。',
    `【话术码】${code}`,
    `【原文】${safeText}`,
    `【变量】${JSON.stringify(safeVars)}`,
  ].join('\n');

  /* 🔴 组装后机检：prompt 不得含任何被剥字段原值（A-C07 出参审计，防白名单漏网） */
  for (const s of stripped) {
    if (s.original.length >= 2 && prompt.includes(s.original))
      return { text: statics.text, source: 'static', code, board: statics.board,
        fallbackReason: 'audit_leak_blocked', leakedKey: s.key };
  }

  try {
    const polished = await withTimeout(client.complete(prompt), timeoutMs);
    const text = polished == null ? '' : String(polished).trim();
    if (!text) return { text: statics.text, source: 'static', code, board: statics.board, fallbackReason: 'empty_ai_reply' };
    return { text, source: 'ai', code, board: statics.board, prompt, sanitized: safeVars };
  } catch (e) {
    return { text: statics.text, source: 'static', code, board: statics.board,
      fallbackReason: e && e.code === 'AI_TIMEOUT' ? 'ai_timeout' : 'ai_error' };
  }
}

/**
 * 统一出口：白话位装配（module = 板块，须与 code 归属一致）。
 * 事件留痕 payload 只含 {module, code, source, fallbackReason}——零 vars、零客户明细（A-C07 延伸）。
 */
export async function talkFor(db, ctx, { module, code, vars = {}, aiClient = null, opts = {} }) {
  const board = CODE_BOARD[code];
  if (!board) {
    const e = new Error(`未知话术码：${code}`);
    e.code = 'UNKNOWN_TALK_CODE';
    throw e;
  }
  if (module && module !== board) {
    const e = new Error(`话术码 ${code} 属 ${board}，不属 ${module}`);
    e.code = 'TALK_CODE_BOARD_MISMATCH';
    throw e;
  }
  const r = await aiPolish(aiClient, code, vars, opts);
  await logEvent(db, ctx, 'talk_rendered', code,
    { module: board, code, source: r.source, ...(r.fallbackReason ? { fallbackReason: r.fallbackReason } : {}) });
  return r;
}
