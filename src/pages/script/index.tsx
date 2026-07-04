/**
 * /script · 演示脚本页（P7，给商务）：10 分钟讲解动线＋话术提词。
 * 动线按《演示版施工包》：30 秒三问 → 团队一屏 → 现场建档推单 → 销售端 → 锁卡＋点亮 → 报价收尾。
 */
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui';

interface Step {
  time: string;
  title: string;
  route?: string;
  routeLabel?: string;
  actions: string[];
  lines: string[];
}

const STEPS: Step[] = [
  {
    time: '开场 30 秒',
    title: '看板三问（今天干什么 / 生意好不好 / 钱在哪）',
    route: '/boss',
    routeLabel: '打开老板看板',
    actions: ['直接把手机递给老板，或投屏 /boss', '只指三处：区一置顶、心跳六数、钱事分诊条', '不要讲功能，30 秒内闭嘴让他看'],
    lines: [
      '「我不给你讲功能，你就看这一页——上面第一行是你今天必须拍的板，系统排好了序；中间六个数是你生意的心跳，每个数下面一句人话；这条红黄绿是你的钱：左边在漏多少、中间躺着多少没去拿、右边几个人在替你赚。」',
    ],
  },
  {
    time: '第 1–3 分钟',
    title: '团队一屏（“王五每天在花你的钱”）',
    route: '/boss',
    routeLabel: '滚动到区四',
    actions: ['指王五那行：47 天零业务事件、labor_roi 为负、月回款 ¥0', '再指王丽：labor_roi 2.10、全员第 1', '指李强：新人第 38 天，亏损爬坡是正常节奏'],
    lines: [
      '「你全 team 一人一行，谁在烧钱谁是标杆，一眼一个色。这位王五，47 天没有一条业务事件，工资每天照扣——这张表不告状，它只是每天都在这儿。」',
    ],
  },
  {
    time: '第 3–5 分钟',
    title: '现场建档推单（可信度关键：所有数字联动）',
    route: '/sales/customers/new',
    routeLabel: '打开建档页',
    actions: [
      '现场建一个客户（手机号用新号，如 138 0013 8000）',
      '顺手演查重：再录一遍同号 → 被硬拦截并显示脱敏归属',
      '客户卡上一路推进到成交，录回款 ¥8,000',
      '回 /boss：月回款、本月成交、pace、早报、排名全部当场变',
    ],
    lines: [
      '「注意，我没有在后台改任何数——刚才这一单，是从建档一路推到成交的真实事件流。你看板上每个数字都跟着动了。这套系统里不存在手工填报表。」',
    ],
  },
  {
    time: '第 5–6 分钟',
    title: '销售端（“销冠也爱用”——讲给旁边的销冠听）',
    route: '/sales',
    routeLabel: '切到王丽视角',
    actions: ['指悬赏令置顶、待推进 Top 5、排名升降箭头', '强调：销售端没有任何利润/成本数字，只有行动'],
    lines: [
      '「销售打开就三眼：顶上有没有彩头、今天先推谁、我排第几——看完拿起电话。系统不拿别的烦他，也永远不给他看你的利润。」',
    ],
  },
  {
    time: '第 6–9 分钟',
    title: '锁卡讲缺口 ＋ 一键点亮（成交高潮）',
    route: '/boss',
    routeLabel: '滚动到区五武器坞',
    actions: [
      '先讲锁卡三要素：一句价值主张、数据就绪徽标、试看申请',
      '点开「人效操盘包」样例长页：王五每月净烧 ¥8,900',
      '回看板 → 按「一键点亮全家桶」：分诊条与心跳第 6 格亮起示例值',
      '再一键回锁——先看见缺口，再看见点亮后的世界',
    ],
    lines: [
      '「这排卡你注意看：亮着的是每天替你干活的；上着锁的，锁的不是功能，是你自己账上已经攒好的数据——214 笔成交、90 天事件流，都在等钥匙。你不开，它们就一直在那儿等着。」',
      '「（点亮后）这就是付费之后的世界：在漏的钱有数、待拿的钱有数、谁回本了有数。（回锁）现在它又变回 — 了——数据还在，只差你一句话。」',
    ],
  },
  {
    time: '第 9–10 分钟',
    title: '报价与创始租户权益收尾',
    actions: ['报主套餐价与四包加购价（线下价目表）', '抛创始租户权益：锁价 ＋ 优先排产 ＋ 陪跑', '收尾问一句：「主套餐先上，四包您想先开哪一个？」'],
    lines: [
      '「老板，这一页你每天扫 30 秒就够了——剩下的，是你看完这 30 秒之后忍不住要点开的东西。」',
    ],
  },
];

export default function ScriptPage() {
  return (
    <div className="min-h-dvh bg-gray-100 pb-24">
      <header className="bg-gray-900 px-4 py-4 text-white">
        <div className="mx-auto max-w-md lg:max-w-3xl">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold">演示脚本 · 商务 10 分钟动线</h1>
            <Link to="/" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">← 演示首页</Link>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            演示前：按右下 ↺ 重置数据；把手机递给老板前按 🔓 锁定防误触；全程可离线。
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-3 px-3 pt-3 lg:max-w-3xl">
        {STEPS.map((s, i) => (
          <Card key={i}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-bold text-white">{s.time}</span>
                <h2 className="text-sm font-bold text-gray-900">{s.title}</h2>
              </div>
              {s.route && (
                <Link to={s.route} className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
                  {s.routeLabel} →
                </Link>
              )}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {s.actions.map((a, j) => (
                <li key={j} className="flex gap-1.5"><span className="text-gray-300">▸</span>{a}</li>
              ))}
            </ul>
            {s.lines.map((l, j) => (
              <div key={j} className="mt-2 rounded-xl border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs italic leading-5 text-gray-700">
                提词：{l}
              </div>
            ))}
          </Card>
        ))}

        <Card className="!bg-gray-900 text-gray-200">
          <h2 className="text-sm font-bold text-white">三条底线（演示中绝不违反）</h2>
          <ul className="mt-2 space-y-1 text-xs leading-5">
            <li>1. 锁卡上永远不出现任何“计算结果”——缺口只用 — 和价值语呈现（货架诚实法则）。</li>
            <li>2. 销售端永远不出现利润/成本字样——当着销冠也能放心演示。</li>
            <li>3. 所有看板数字来自事件流实时折算——欢迎老板当场点一单验证联动。</li>
          </ul>
        </Card>
      </main>
    </div>
  );
}
