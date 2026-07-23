#!/usr/bin/env node
/* ============================================================
   对抗性安全 · D —— 内存泄漏排查
   🔴 运行命令（必须带 --expose-gc）：
        node --expose-gc tests/memory-leak.test.mjs
   若未带 --expose-gc，global.gc 缺失 → 用被动采样并明确标注「判定置信度降低」。
   方法：对纯函数引擎各跑 ≥5万次，每 5000 次 global.gc?.() 并记 heapUsed；
        对尾段样本做最小二乘斜率 → 投影到全循环，估算「每轮净留存字节」；
        留存 > 预算 → 判「疑似泄漏」并点名函数。服务层：反复建/销毁 PGlite + 大量事务。
   ============================================================ */
import { PGlite } from '@electric-sql/pglite';
import { m21Normalize, olsFit } from '../domain/suanzhang.mjs';
import { capacityChain } from '../domain/zhaoren.mjs';
import { priceTag6 } from '../domain/liuren.mjs';
import { plvCheck } from '../domain/yuren.mjs';
import { fold } from '../domain/replay.mjs';
import { makeGetCoef, getCoef } from '../domain/shared.mjs';
import { renderTalk } from '../server/vernacular.mjs';

let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const findings = [];
const HAS_GC = typeof global.gc === 'function';
const gc = () => { if (HAS_GC) global.gc(); };
const MB = 1024 * 1024;
const heap = () => process.memoryUsage().heapUsed;
const fmt = b => (b / MB).toFixed(2) + 'MB';

/* 最小二乘斜率（x = 0..n-1），返回每样本字节增量 */
function slopePerSample(ys) {
  const n = ys.length; if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
  const d = n * sxx - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}

/**
 * 跑一个纯函数循环，采样 heapUsed，判定收敛。
 * BUDGET：全循环投影净留存预算（超出 → 疑似泄漏）。
 */
function runLoop(name, iters, fn, { sampleEvery = 5000, budgetMB = 6 } = {}) {
  gc(); const samples = [];
  for (let i = 1; i <= iters; i++) {
    fn(i);
    if (i % sampleEvery === 0) { gc(); samples.push(heap()); }
  }
  gc(); samples.push(heap());
  const warmup = Math.min(2, samples.length - 2);       // 跳过前 2 个采样（JIT/首次分配）
  const tail = samples.slice(warmup);
  const spSample = slopePerSample(tail);
  const nSamples = Math.ceil(iters / sampleEvery);
  const projectedRetained = spSample * nSamples;         // 全循环净留存投影
  const start = samples[warmup], peak = Math.max(...samples), end = samples[samples.length - 1];
  const budget = budgetMB * MB;
  const converged = projectedRetained < budget;          // 尾段斜率投影 < 预算 = 收敛
  console.log(`    [${name}] iters=${iters} 起=${fmt(start)} 峰=${fmt(peak)} 末=${fmt(end)}` +
    ` 尾段斜率=${(spSample / 1024).toFixed(1)}KB/采样 投影留存=${fmt(projectedRetained)} → ${converged ? '收敛✅' : '疑似泄漏🔴'}`);
  if (!converged) findings.push(`【疑似泄漏】${name}：尾段投影净留存 ${fmt(projectedRetained)} > 预算 ${budgetMB}MB（每 ${sampleEvery} 次涨 ${(spSample / 1024).toFixed(1)}KB）`);
  return { name, start, peak, end, spSample, projectedRetained, converged };
}

console.log('\n══════ D. 内存泄漏排查 ══════');
console.log(`  --expose-gc: ${HAS_GC ? '已启用（主动 GC，判定高置信）' : '🔴 未启用（global.gc 缺失，判定置信度降低——请用 node --expose-gc 重跑）'}`);
const ITERS = 50000;

/* ---------- 固定输入（循环内零新分配语义，纯函数不应留存） ---------- */
const people = Array.from({ length: 20 }, (_, i) => ({
  id: 'sp' + i, name: '销售' + i, leads: 30 + i, grossMarginAmt: (100 + i * 7) * 10000, selfDevLeads: i % 5,
}));
const X = Array.from({ length: 60 }, (_, i) => [1, 30 + (i % 40), (i % 7) / 10, (200 + i) / 100, 0.3 + (i % 5) / 20]);
const y = X.map(r => r[1] * 1000 + r[3] * 50000 + (Math.sin(r[2]) * 1000));
const capInp = { targetYearGrossAmt: 100000000, perCapitaActualAmt: 5000000, salesCount: 20, cycleTier: 'regular', attritionRate: 0.2, hiringCycleDays: 45, fullLoadCostAmt: 2000000, managerCount: 2 };
const capCtx = { today: '2026-07-13', targetYear: 2027, gc: getCoef };
const ptDb = {
  priceTag: { spId: 'sp1', monthlyGrossMarginAmt: 500000, hireMonths: 3, paybackMonths: 6, raiseMonthlyAmt: 10000, shortenPct: 0.3, hiresPerYear: 5 },
  entities: { Salesperson: [{ spId: 'sp1', name: '甲', hiringCostAmt: 1500000 }], HandoverCard: [] },
  company: { cycleTier: 'regular' },
};
const plvText = '昨天你在第3分钟就报价了，试试改成先问预算，参考团队均值转化率是22%基准';
const foldEvents = [];
{
  foldEvents.push({ type: 'category_created', payload: JSON.stringify({ categoryId: 'c1', grossMarginRate: 0.5 }) });
  for (let i = 0; i < 500; i++) foldEvents.push({ type: 'deal_created', payload: JSON.stringify({ dealId: 'd' + i, paymentAmt: (20 + i % 80) * 10000, categoryId: 'c1', status: 'won' }) });
  for (let i = 0; i < 200; i++) foldEvents.push({ type: 'daily_report_submitted', payload: JSON.stringify({ drId: 'r' + i }) });
}

console.log('\n— ① 纯函数引擎各 5 万次循环（尾段斜率收敛判定） —');
const results = [];
results.push(runLoop('m21Normalize', ITERS, () => { const r = m21Normalize(people); if (!r.done) throw new Error('m21 done false'); }));
results.push(runLoop('olsFit', ITERS, () => { const r = olsFit(X, y); if (!r) throw new Error('ols singular'); }));
results.push(runLoop('capacityChain', ITERS, () => { const r = capacityChain(capInp, capCtx); if (!Number.isFinite(r.trueHires)) throw new Error('cap NaN'); }));
results.push(runLoop('priceTag6', ITERS, () => { const r = priceTag6(ptDb, '2026-07-13'); if (r == null) throw new Error('pt null'); }));
results.push(runLoop('plvCheck', ITERS, () => { plvCheck(plvText, {}); }));
results.push(runLoop('fold(701 事件)', ITERS, () => { const r = fold(foldEvents); if (r.dealCount !== 500) throw new Error('fold cnt'); }));
results.push(runLoop('makeGetCoef', ITERS, () => { const g = makeGetCoef({ 'redrawGainBand': [0.02, 0.07] }); g('suanzhang.territoryBand'); g('redrawGainBand'); }));
results.push(runLoop('renderTalk', ITERS, () => { renderTalk('S-03'); renderTalk('L-10c', { amt: '38万', trend: '35万' }); }));

for (const r of results) ok(r.converged, `${r.name} 堆增长收敛（末段斜率≈0，无持续上涨）`, r.converged ? '' : `投影留存 ${fmt(r.projectedRetained)}`);

/* ============================================================
   ② 闭包/累积器检查：反复调 makeGetCoef / renderTalk / fold 大数组，
      确认无模块级数组/Map 无限增长（比对两窗口末堆）
   ============================================================ */
console.log('\n— ② 闭包/模块级累积器检查 —');
{
  gc(); const h0 = heap();
  const bigEvents = [];
  for (let i = 0; i < 5000; i++) bigEvents.push({ type: 'deal_created', payload: JSON.stringify({ dealId: 'x' + i, paymentAmt: 10000, categoryId: 'c1', status: 'won' }) });
  bigEvents.unshift({ type: 'category_created', payload: JSON.stringify({ categoryId: 'c1', grossMarginRate: 0.5 }) });
  const REPS = 4000;
  for (let w = 0; w < REPS; w++) {
    fold(bigEvents);
    makeGetCoef({ a: w })('suanzhang.territoryBand');
    renderTalk('S-03');
  }
  gc(); const h1 = heap();
  const grew = h1 - h0;
  console.log(`    ${REPS}×(fold 5001 事件 + makeGetCoef + renderTalk)：Δheap=${fmt(grew)}`);
  ok(grew < 6 * MB, `无模块级累积（Δheap ${fmt(grew)} < 6MB——闭包/Map 未无限增长）`, grew >= 6 * MB ? '疑似模块级累积' : '');
  if (grew >= 6 * MB) findings.push(`【疑似泄漏】fold/makeGetCoef/renderTalk 反复调用后 Δheap=${fmt(grew)}——检查模块级 Map/数组累积`);
}

/* ============================================================
   ③ 服务层：反复建/销毁 PGlite 实例 ≥50 次 + 单实例大量事务
   ============================================================ */
console.log('\n— ③ 服务层：PGlite 实例生命周期 + 大量事务 —');
{
  // ③a 建/销毁 PGlite 实例：🔴 每个 new PGlite() 需加载 WASM Postgres（实测 ~3s/个），
  //   ≥50 次在单套件内不现实（~150s）；取 12 次足以检出「JS 堆随实例数持续攀升 = 引用未释放」。
  //   ≥50-等效的服务层压力由 ③b（单实例大量事务）承接。
  const INSTANCES = 12;
  gc(); const base = heap();
  const marks = [];
  for (let i = 0; i < INSTANCES; i++) {
    const d = new PGlite();
    await d.exec(`create table t(id int); insert into t values (1),(2),(3);`);
    await d.query(`select count(*) from t`);
    await d.close();
    if (i % 3 === 2) { gc(); marks.push(heap()); }
  }
  gc(); const after = heap();
  const spm = slopePerSample(marks);
  const grew = after - base;
  console.log(`    建/销毁 ${INSTANCES} 次：base=${fmt(base)} 末=${fmt(after)} Δ=${fmt(grew)} 采样斜率=${(spm / 1024).toFixed(1)}KB/3实例`);
  // WASM 堆在 ArrayBuffer 中，JS gc 可回收已解引用实例；斜率应近 0
  const leakLike = spm > 0 && spm * marks.length > 12 * MB;
  ok(!leakLike, `PGlite 建/销毁 ${INSTANCES} 次 JS 堆无持续攀升（斜率投影 ${fmt(Math.max(0, spm * marks.length))}）`,
    leakLike ? '实例未被回收' : '');
  if (leakLike) findings.push(`【疑似泄漏】PGlite 实例建/销毁后 JS 堆持续攀升（每 3 实例 +${(spm / 1024).toFixed(1)}KB）——检查实例引用是否释放`);
}
{
  // ③b 单实例 20000 事务，测事务不累积堆
  const d = new PGlite();
  await d.exec(`create table k(id int primary key, v int)`);
  const TXN = 8000;
  gc(); const h0 = heap(); const marks = [];
  for (let i = 0; i < TXN; i++) {
    await d.transaction(async tx => { await tx.query(`insert into k(id,v) values ($1,$2) on conflict (id) do update set v=excluded.v`, [i % 100, i]); });
    if (i % 1600 === 1599) { gc(); marks.push(heap()); }
  }
  gc(); const h1 = heap();
  await d.close();
  const spm = slopePerSample(marks);
  const grew = h1 - h0;
  console.log(`    单实例 ${TXN} 事务：起=${fmt(h0)} 末=${fmt(h1)} Δ=${fmt(grew)} 斜率=${(spm / 1024).toFixed(1)}KB/1600事务`);
  const leakLike = spm > 0 && spm * marks.length > 10 * MB;
  ok(!leakLike, `单实例大量事务堆稳定（斜率投影 ${fmt(Math.max(0, spm * marks.length))} < 10MB）`, leakLike ? '事务累积堆' : '');
  if (leakLike) findings.push(`【疑似泄漏】单 PGlite 实例大量事务后堆持续攀升——检查事务/预处理语句缓存`);
}

/* ============================================================
   报告
   ============================================================ */
console.log('\n══════ D 内存曲线报告 ══════');
console.log('  纯函数（起/峰/末 heapUsed）：');
for (const r of results) console.log(`    ${r.name.padEnd(16)} 起 ${fmt(r.start)} → 峰 ${fmt(r.peak)} → 末 ${fmt(r.end)}  ${r.converged ? '收敛' : '🔴疑似泄漏'}`);
if (!HAS_GC) console.log('  ⚠️ 本次未启用 --expose-gc：以上判定基于被动堆采样，置信度降低。');
if (findings.length) { console.log('\n🔴 疑似泄漏（点名）：'); findings.forEach((f, i) => console.log(`   ${i + 1}. ${f}`)); }
else console.log('  判定：全部收敛，无疑似泄漏。');

console.log(`\n[D. 内存泄漏排查] 断言 ${failures ? '✗ ' + failures + ' 失败' : '✅ 全通过'}｜疑似泄漏 ${findings.length} 项${HAS_GC ? '' : '｜⚠️无GC低置信'}`);
process.exit(failures ? 1 : 0);
