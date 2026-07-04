/**
 * npm run domain-check（P2 验收）：
 *  A. 口径引擎边界用例（七级左闭右开、并列跳号、pace 比率类返回 null、停滞三级、环比完整月）
 *  B. 对种子事件流跑综合折算，逐项对拍《第二件·3》关键数（82/9/11%/¥6,800/¥61.2万/1.52）
 *  C. 双通道交叉验证：compute 客户态分布 ≡ fold 存量；月人力成本合计 ≡ 累计人力成本
 */
import { generateSeed } from '../src/seed/generator';
import { computeAll } from '../src/domain/compute';
import {
  absRate, completedMonthPair, dailyTarget, fmtPct1, fmtRoi2, momRate, paceRate,
  rankJump, sevenLevel, stallLevel, stayDays, tenureDays,
} from '../src/domain/engine';

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', N = '\x1b[0m';
let failed = 0;
let group = '';
function sec(name: string) { group = name; console.log(`\n${B}── ${name} ──${N}`); }
function t(name: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? `${G}✓${N}` : `${R}✗${N}`} ${name}${detail ? ` ＝ ${detail}` : ''}`);
  if (!pass) failed++;
}
function eq(name: string, expected: unknown, actual: unknown) {
  t(name, String(expected) === String(actual), String(expected) === String(actual) ? String(actual) : `期望 ${expected}，实得 ${actual}`);
}

// ================= A. 引擎边界用例 =================

sec('七级考核等级（§6.8 左闭右开，自上而下首次命中即停）');
eq('200% → 领先·紫', '领先', sevenLevel(2.0)?.name);
eq('199.99% → 优秀（区间右开）', '优秀', sevenLevel(1.9999)?.name);
eq('150% → 优秀·蓝（左闭）', '优秀', sevenLevel(1.5)?.name);
eq('120% → 良好·绿（左闭）', '良好', sevenLevel(1.2)?.name);
eq('119.9% → 合格', '合格', sevenLevel(1.199)?.name);
eq('100% → 合格·白（左闭）', '合格', sevenLevel(1.0)?.name);
eq('99.99% → 黄色预警（右开）', '黄色预警', sevenLevel(0.9999)?.name);
eq('80% → 黄色预警（左闭）', '黄色预警', sevenLevel(0.8)?.name);
eq('79.99% → 橙色预警', '橙色预警', sevenLevel(0.7999)?.name);
eq('60% → 橙色预警（左闭）', '橙色预警', sevenLevel(0.6)?.name);
eq('59.99% → 红色预警', '红色预警', sevenLevel(0.5999)?.name);
eq('0% → 红色预警', '红色预警', sevenLevel(0)?.name);
eq('目标未设 null → null（显 —）', 'null', String(sevenLevel(null)));

sec('排名（§6.10 全精度比较 · 并列跳号 1、1、3 · 时间早者前）');
{
  const rows = rankJump([
    { id: 'a', value: 100, tieTime: 5 },
    { id: 'b', value: 100, tieTime: 2 },
    { id: 'c', value: 80 },
    { id: 'd', value: 80 },
    { id: 'e', value: 10 },
  ]);
  eq('并列跳号序列', '1,1,3,3,5', rows.map((r) => r.rank).join(','));
  eq('并列内部次序＝事件发生时间早者前', 'b', rows[0].id);
  const prec = rankJump([{ id: 'x', value: 0.1 + 0.2 }, { id: 'y', value: 0.3 }]);
  eq('全精度比较（0.1+0.2 ≠ 0.3 不并列）', '1,2', prec.map((r) => r.rank).join(','));
}

sec('达标率与目标分解（§6.7 ＋ 盲审定案：比率类不拆日）');
eq('abs_rate 612000/550000', '111.3%', fmtPct1(absRate(612000, 550000)));
eq('目标为 0 → null 显 —', 'null', String(absRate(1, 0)));
{
  const p = paceRate(612000, 550000, 29, 30);
  eq('pace_rate＝实际÷(目标×已过/总天)', '115.1%', fmtPct1(p));
  eq('pace 落七级 → 合格档', '合格', sevenLevel(p)?.name);
}
eq('比率类目标不算 pace（isRatio → null）', 'null', String(paceRate(0.5, 0.4, 29, 30, true)));
eq('单日目标＝月度目标÷当月自然天数（24÷30）', '0.8', String(dailyTarget(24, '2026-06')));
eq('单日目标：目标未设 → null', 'null', String(dailyTarget(0, '2026-06')));

sec('环比（§6.5 仅完整自然月 · 上期≤0 显 —）');
eq('锚点 6-29 的完整月对', '2026-04,2026-05', completedMonthPair('2026-06-29').join(','));
eq('上期＝0 → null', 'null', String(momRate(0, 100)));
eq('上期为负（净利类）→ null', 'null', String(momRate(-5, 100)));
eq('(61.2−46.5)÷46.5', '+31.6%', (() => { const m = momRate(465000, 612000)!; return `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)}%`; })());

sec('停滞预警（§8 三级 · 通用列阈值 15/30/20/7 · 左闭）');
eq('进入当日记 0', 0, stayDays('2026-06-29', '2026-06-29'));
eq('线索 14 天 → 无预警', 'null', String(stallLevel('lead', 14)));
eq('线索 15 天 → 关注（左闭：达到当天即触发）', 'watch', String(stallLevel('lead', 15)));
eq('线索 22 天 → 关注（示例：关注 15–22）', 'watch', String(stallLevel('lead', 22)));
eq('线索 23 天 → 预警（示例：预警 23–37）', 'warning', String(stallLevel('lead', 23)));
eq('线索 37 天 → 预警', 'warning', String(stallLevel('lead', 37)));
eq('线索 38 天 → 濒死（示例：濒死 38+）', 'dying', String(stallLevel('lead', 38)));
eq('签约未回款 18 天 → 濒死（示例：7 天阈值濒死＝18 天起）', 'dying', String(stallLevel('signed', 18)));
eq('签约未回款 17 天 → 预警', 'warning', String(stallLevel('signed', 17)));
eq('意向 30 天 → 关注（阈值 30）', 'watch', String(stallLevel('intent', 30)));
eq('样品 50 天 → 濒死（2.5×20）', 'dying', String(stallLevel('sample', 50)));

// ================= B. 对种子逐项对拍关键数 =================

const data = generateSeed();
const c = computeAll(data);

sec('对拍《第二件·3》关键数（全部由事件流实时折算）');
eq('样品池本月进入', 82, c.folded.monthlyPoolFlow['2026-06'].sample.entered);
eq('样品池本月转出', 9, c.folded.monthlyPoolFlow['2026-06'].sample.exited);
eq('本月样品转出率', '11.0%', fmtPct1(c.folded.monthlyPoolFlow['2026-06'].sample.exited / c.folded.monthlyPoolFlow['2026-06'].sample.entered));
eq('上月样品转出率', '27.0%', fmtPct1(c.folded.monthlyPoolFlow['2026-05'].sample.exited / c.folded.monthlyPoolFlow['2026-05'].sample.entered));
eq('公司本月回款', 612000, c.company.monthRevenue);
eq('平均客单 aov', '¥6800.00', `¥${(c.folded.cumRevenue / c.folded.totalDealCnt).toFixed(2)}`);
eq('团队 labor_roi（先汇总再算）', '1.52', fmtRoi2(c.folded.teamLaborRoi));
eq('月度回款目标 ¥55 万 pace 档位', '合格', sevenLevel(paceRate(c.company.monthRevenue, data.targets.companyMonthlyRevenue, 29, 30))?.name);

sec('人物钩子（口径引擎侧）');
eq('王丽 labor_roi', '2.10', fmtRoi2(c.folded.perOwnerRoi['wangli']));
eq('王丽全员总排名第 1（月回款）', 1, c.rankings.totalByOwner['wangli']);
eq('王丽部门内排名第 1', 1, c.rankings.deptByOwner['wangli']);
t('王五存在濒死停滞客户（47 天零事件）', c.owners['wangwu'].stall.dying > 0, `dying=${c.owners['wangwu'].stall.dying}`);
eq('李强在职天数（R2-01 含首日）', 38, tenureDays(data.people.find((p) => p.id === 'liqiang')!.hireDate!, data.anchorDate));
t('赵敏样品转化率 ≈9%（≤12%）', (c.owners['zhaomin'].conv.sample ?? 1) <= 0.12, fmtPct1(c.owners['zhaomin'].conv.sample));
t('销售一部部门间排名第 1（月回款）', c.rankings.deptRank[0].id === 'd1', `${c.rankings.deptRank.map((r) => `${r.id}#${r.rank}`).join(' ')}`);

sec('停滞列表排序（§8.5.1 等级→ABCD→天数倒序）');
{
  let sorted = true;
  const lv: Record<string, number> = { dying: 0, warning: 1, watch: 2 };
  const ab: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  const cmp = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  for (let i = 1; i < c.stallList.length; i++) {
    const a = c.stallList[i - 1], b = c.stallList[i];
    if (cmp([lv[a.level], ab[a.abcd], -a.days], [lv[b.level], ab[b.abcd], -b.days]) > 0) { sorted = false; break; }
  }
  t('列表全序合规', sorted, `共 ${c.stallList.length} 家停滞`);
  t('在管客户数＝四池存量和', c.company.inManaged === c.folded.stocks.lead + c.folded.stocks.intent + c.folded.stocks.sample + c.folded.stocks.signed, String(c.company.inManaged));
}

sec('双通道交叉验证（compute 客户态 ≡ fold 折算）');
{
  const dist: Record<string, number> = { lead: 0, intent: 0, sample: 0, signed: 0, deal: 0, lost: 0 };
  for (const lc of c.customers.values()) dist[lc.stage]++;
  for (const s of ['lead', 'intent', 'sample', 'signed', 'deal', 'lost'] as const) {
    eq(`${s} 存量（两条独立折算通道一致）`, c.folded.stocks[s], dist[s]);
  }
  const laborSum = Object.values(c.company.laborByMonth).reduce((a, b) => a + b, 0);
  t('Σ月人力成本 ≡ 累计人力成本', Math.abs(laborSum - c.folded.totalLaborCost) < 0.01, laborSum.toFixed(2));
  const ownerMonthSum = Object.values(c.owners).reduce((a, o) => a + o.monthRevenue, 0);
  eq('Σowner 月回款 ≡ 公司月回款', c.company.monthRevenue, ownerMonthSum);
  const dealsFromOrders = [...c.customers.values()].filter((lc) => lc.orders.length > 0).length;
  eq('有成交单客户数 ≡ total_deal_cnt', c.folded.totalDealCnt, dealsFromOrders);
}

sec('环比（种子实算 · 完整月 4→5 月）');
{
  eq('完整月对', '2026-04,2026-05', c.company.momPair.join(','));
  t('回款环比可算（上期>0）', c.company.revenueMom != null, fmtPct1(c.company.revenueMom));
  t('净利环比可算（上期>0）', c.company.netMom != null, fmtPct1(c.company.netMom));
  t('4 月净利＝毛利−人力成本 > 0', (c.company.netByMonth['2026-04'] ?? 0) > 0, (c.company.netByMonth['2026-04'] ?? 0).toFixed(2));
}

console.log('');
if (failed > 0) {
  console.error(`${R}${B}✗ domain-check 未通过：${failed} 项失败${N}`);
  process.exit(1);
}
console.log(`${G}${B}✓ domain-check 全绿${N}`);
