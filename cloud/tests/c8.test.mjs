#!/usr/bin/env node
/* C8 信用层验收（v5.1 §12 C8 行：M16/M28/M29/M30/M37/M38）：
   ① AHC：computeIndices 落 derived_scalars（种子口径手算对照）→ salesBundle 含
      ahc 四拆解+拦截记录；🔴 老板零编辑：grep 全部 server/*.mjs——derived_scalars
      'ahc' 键写形（key: 'ahc'）仅 m29.computeIndices 一处 + 无任何 export 函数
      签名接受外部 ahc 值参数（L-D2 写侧唯一断言）
   ② 🔴 irrevocable（L-D1/T12）：tryDowngrade → ok:false + m28_agreements 行零改动
      + override_events +1 + AHC 下降（before>after）；直接 SQL UPDATE rate 下调 → 触发器拒
   ③ 🔴 钱途页 grep（A-08/A-09/L-D3）：salesBundle 序列化后正则
      /grossMargin|netContribution|laborRoi|aov|scissors|discountLeak|uer|rank|peerCompare|redAlert/i
      零命中（本人回款豁免字段名 myCollected）
   ④ M37 三态（T13）：历史 3 万/增长 26.7% → 趋势 38000 取整；28000🔴/30000🟡/38000🟢
   ⑤ M38（T14）：离职登记 → 3 张 talk 卡 + 余震 2/2/1 排序；11 单 96 万 → 38.4/19.2 万；
      handover_cards 无删除路径（触发器）；价签第⑥项读侧回填
   ⑥ M30：匿名建议 employee_id/created_by 均 null 且事件 payload 无 actor 标识；
      异议 pending>7 天 sweep 失效（mark_active=false）；EI 随提交实时变
   ⑦ 该谈名单（T15）：榜眼 连3月第2∧零特殊发放 → 触发、2 月不触发；周年 14 天内触发
   ⑧ 事件双写抽查；⑨ 回归 spawnSync c2–c7
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, upsert } from '../server/writes.mjs';
import { createPlanVersion } from '../server/m2.mjs';
import {
  computeIndices, readIndices, setBossOpLog, bossOpLogOn, submitSelfRating, selfDeviation,
} from '../server/m29.mjs';
import { createM28, tryDowngrade, m28Board } from '../server/m28.mjs';
import { priceTagFor, guardLine, talkListNow, dependencyRadarNow } from '../server/m16.mjs';
import { payoutPrecheckFor, offboard, addHandoverCard, handoverSummaryFor } from '../server/m37_38.mjs';
import {
  raiseObjection, resolveObjection, raiseSuggestion, resolveSuggestion, sweepObjections, ANON_ACTOR,
} from '../server/m30.mjs';
import { salesBundle, bossBundle } from '../server/bundles.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) < eps;

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日
const CUR = '2026-07';

/* ================= ⓪ 静态断言 ================= */
console.log('— ⓪ 静态断言：零 new Date() + 🔴 L-D2 写侧唯一（ahc 键写形仅 m29.computeIndices） —');
{
  const C8_FILES = ['m29.mjs', 'm28.mjs', 'm16.mjs', 'm37_38.mjs', 'm30.mjs', 'bundles.mjs'];
  const clockHits = C8_FILES.filter(f => /new Date\(/.test(readFileSync(join(root, 'server', f), 'utf8')));
  ok(clockHits.length === 0, 'C8 六个服务模块零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));

  /* 🔴 ①写侧唯一断言：derived_scalars 'ahc' 键的写形（key: 'ahc'）全 server 目录仅 m29 一处，
     且该处位于 computeIndices 函数体内（读侧 SQL 形为 key = 'ahc'，不在本断言范围） */
  const serverFiles = readdirSync(join(root, 'server')).filter(f => f.endsWith('.mjs'));
  const writeShape = /key:\s*['"]ahc['"]/g;
  const offenders = [];
  let m29Hits = 0;
  for (const f of serverFiles) {
    const src = readFileSync(join(root, 'server', f), 'utf8');
    const hits = (src.match(writeShape) || []).length;
    if (f === 'm29.mjs') m29Hits = hits;
    else if (hits > 0) offenders.push(`${f}×${hits}`);
  }
  ok(offenders.length === 0, `🔴 'ahc' 写形零出现于 m29 之外的 server 模块`, offenders.join(','));
  const m29src = readFileSync(join(root, 'server', 'm29.mjs'), 'utf8');
  const fnStart = m29src.indexOf('export async function computeIndices');
  const fnEnd = m29src.indexOf('export', fnStart + 10);
  const inBody = (m29src.slice(fnStart, fnEnd).match(writeShape) || []).length;
  ok(m29Hits === 1 && inBody === 1, `🔴 m29 的 'ahc' 写形恰 1 处且在 computeIndices 内（${m29Hits}/${inBody}）`);

  /* ①无任何接受外部 ahc 值的参数（export 函数签名扫描） */
  const sigOffenders = [];
  for (const f of serverFiles) {
    const src = readFileSync(join(root, 'server', f), 'utf8');
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g))
      if (/\bahc\b/.test(m[2])) sigOffenders.push(`${f}:${m[1]}`);
  }
  ok(sigOffenders.length === 0, '🔴 全 server 无 export 函数签名接受 ahc 参数（老板零编辑入口）', sigOffenders.join(','));

  /* ② L-D1 服务层：m28.mjs 对 m28_agreements 零 patch/UPDATE 语句（触发器为第二道保险） */
  const m28src = readFileSync(join(root, 'server', 'm28.mjs'), 'utf8');
  ok(!/patch\([^)]*m28_agreements/.test(m28src) && !/update\s+m28_agreements/i.test(m28src),
    '🔴 m28.mjs 零 m28_agreements 写改路径（tryDowngrade 只留痕，行零改动）');
}

/* ================= 环境：PGlite + schema 五段执行 ================= */
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role authenticated nologin;
  create role app_user login;
  grant usage on schema public to app_user;
  grant authenticated to app_user;
`);
for (const f of ['schema.sql', 'schema-c2.sql', 'schema-c3.sql', 'schema-c4.sql', 'schema-c6.sql']) {
  await db.exec(readFileSync(join(root, 'db', f), 'utf8'));
}
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const U = { boss: 'a0000000-0000-4000-8000-00000000000a' };
const mkTenant = async name => (await q(`insert into tenants(name, created_by) values ($1, $2) returning id`, [name, U.boss]))[0].id;
const esType = async (t, type) => (await q(`select count(*)::int as n from event_stream where tenant_id = $1 and type = $2`, [t, type]))[0].n;

const tG = await mkTenant('C8·治理体检');
const tP = await mkTenant('C8·产权机器');
const tT = await mkTenant('C8·留存引擎');
const tO = await mkTenant('C8·离职余震');
const ctx = t => ({ tenantId: t, actorId: U.boss, today: TEST_TODAY });
const ctxG = ctx(tG), ctxP = ctx(tP), ctxT = ctx(tT), ctxO = ctx(tO);

/* ---------- 种子工具 ---------- */
const mkSp = (c, id, opts = {}) => put(db, c, 'salespersons', {
  id, name: opts.name ?? id, level: opts.level ?? 'sales',
  hire_date: opts.hireDate ?? '2026-01-01', manager_id: opts.managerId ?? null,
  city_tier: opts.cityTier ?? null, hire_batch_id: opts.hireBatchId ?? null,
  base_salary_amt: opts.baseAmt ?? 3000000, is_active: opts.isActive ?? true,
}, 'salesperson_created');
const mkCat = (c, id, rate) => put(db, c, 'categories', { id, name: id, gross_margin_rate: rate }, 'category_created');
const mkDeal = (c, id, employeeId, date, payAmt) => put(db, c, 'deals',
  { id, employee_id: employeeId, deal_date: date, payment_amt: payAmt, category_id: 'cat0',
    margin_rate_snapshot: 0.5, status: 'won', paid_date: date }, 'deal_created');
const mkOp = (c, id, action, ts, targetId = null) => put(db, c, 'boss_op_logs',
  { id, ts, action, target_id: targetId }, 'boss_op_logged');
const mkCov = (c, id, opts = {}) => put(db, c, 'covenants',
  { id, employee_id: opts.employeeId ?? 'G1', lines: [], promise_text: opts.promise ?? null,
    both_confirmed: opts.confirmed ?? false, irrevocable: opts.irrevocable ?? false }, 'covenant_signed');
const mkLedger = (c, id, achievedAt, honoredAt = null) => put(db, c, 'ledger_entries',
  { id, employee_id: 'G1', category: 'contract', promise_text: '承诺', achieved_at: achievedAt,
    honored_at: honoredAt }, 'ledger_entry_appended');
const mkSpot = (c, id, weekOf) => put(db, c, 'spot_check_cards',
  { id, week_of: weekOf, employee_id: 'G1' }, 'spot_check_generated');
const mkNorm = (c, spId, month, rank, leadIndex = null) => upsert(db, c, 'm21_norms',
  { cols: ['tenant_id', 'sp_id', 'month'] },
  { sp_id: spId, month, leads: 100, lead_index: leadIndex, unit_lead_margin: null,
    norm_margin: 1e6, orig_rank: rank, norm_rank: rank },
  'm21_norm_written', { touch: ['computed_at'] });
const mkPayout = (c, id, employeeId, date, type, amt) => put(db, c, 'payout_entries',
  { id, employee_id: employeeId, payout_date: date, type, amount_amt: amt }, 'payout_entry_created');

/* ---------- tG 种子（手算对照口径见 ① 注释） ---------- */
for (let i = 1; i <= 10; i++) await mkSp(ctxG, `G${i}`);
await put(db, ctxG, 'shift_configs', { id: 'sh1', employee_id: 'G1', weekday: 0, is_workday: false }, 'shift_config_set');
{
  let n = 0;
  for (const w of ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'])
    for (let k = 0; k < 3; k++) await mkSpot(ctxG, `sc${++n}`, w);
}
for (let i = 1; i <= 8; i++) await mkOp(ctxG, `op_v${i}`, 'view_detail', '2026-07-05');
for (let i = 1; i <= 4; i++) await mkOp(ctxG, `op_i${i}`, 'card_ignore', '2026-07-01');
await mkOp(ctxG, 'op_a1', 'card_adopt', '2026-07-01');
await mkCov(ctxG, 'c1', { confirmed: true, irrevocable: true });
await mkCov(ctxG, 'c2', { confirmed: true, irrevocable: true });
await mkCov(ctxG, 'c3', { confirmed: true });
await mkCov(ctxG, 'c4', {}); await mkCov(ctxG, 'c5', {});
for (let i = 1; i <= 10; i++) await mkLedger(ctxG, `lg${i}`, '2026-06-20', i <= 6 ? '2026-07-01' : null);
for (let i = 1; i <= 4; i++) await mkOp(ctxG, `op_td${i}`, 'try_downgrade', '2026-06-01', 'm28_x');
for (let i = 1; i <= 2; i++) await mkOp(ctxG, `op_rh${i}`, 'ratchet_hit', '2026-06-01');

/* ================= ① AHC 四指数：手算对照 + 落表 + 老板零编辑 ================= */
console.log('— ① 四指数手算对照 + derived_scalars 落表 + BossOpLog 开关中位数 + 自评偏差 —');
{
  /* 手算：SII = 25(日报恒开) + 15(点名) + 15×(12/4/5)=9 + 0(审批P-3) + 20×(8/40)=4 + 0(处方) = 53
          EI  = 30×0(异议0) + 25×0(建议0→A-19按0计) + 25×(3/5)=15 + 20×(1−4/5)=4 = 19
          AHC = 40×(6/10)=24 + 25×(2/5)=10 + 20×(1−4/10)=12 + 15×(1−2/3)=5 = 51；DVI 无源 → null */
  const r = await computeIndices(db, ctxG);
  ok(r.sii.value === 53, `SII = 53（实际 ${r.sii.value}）`);
  ok(r.ei.value === 19, `EI = 19（实际 ${r.ei.value}）`);
  ok(r.ahc.value === 51 && r.ahc.band === 'danger', `AHC = 51 🔴（实际 ${r.ahc.value}/${r.ahc.band}）`);
  ok(r.dvi.value === null, 'DVI 无算账器数据源 → null（"—"，不硬造）');
  ok(r.ahc.four.length === 4 && near(r.ahc.four[0].points, 24) && near(r.ahc.four[1].points, 10)
    && near(r.ahc.four[2].points, 12) && near(r.ahc.four[3].points, 5),
    `AHC 四拆解 = 24/10/12/5（实际 ${r.ahc.four.map(x => Math.round(x.points * 10) / 10).join('/')}）`);

  const rows = await q(`select key, value_num::float8 as v, computed_at from derived_scalars
    where tenant_id = $1 and scope = 'tenant' and key in ('sii','ei','dvi','ahc') and period = $2 order by key`, [tG, CUR]);
  ok(rows.length === 4 && rows.every(x => x.computed_at != null),
    '四指数落 derived_scalars(tenant) 恰 4 行且带 computed_at（公约 A-21）');
  ok(Number(rows.find(x => x.key === 'ahc').v) === 51 && rows.find(x => x.key === 'dvi').v === null,
    '落表值与计算一致（ahc=51、dvi=null）');

  /* BossOpLog 开关（L-D10）：关闭 → 采集类分项按中位数计入+标注；红线留痕类不受开关约束 */
  const off = await (async () => { await setBossOpLog(db, ctxG, { on: false }); return computeIndices(db, ctxG); })();
  ok(off.bossOpLogOn === false && off.sii.value === 59 && off.ei.value === 25,
    `关闭采集 → SII 59 / EI 25（查看与忽略率按中位数 0.5 计入；实际 ${off.sii.value}/${off.ei.value}）`);
  ok(off.ahc.value === 51, `🔴 AHC 仍 51：try_downgrade/ratchet_hit 为红线留痕（L-D1），不受开关约束`);
  ok(off.notes.some(s => s.includes('BossOpLog 已关闭')), '标注"该项未采集"注入 notes');
  await setBossOpLog(db, ctxG, { on: true });
  const back = await computeIndices(db, ctxG);
  ok(back.sii.value === 53 && back.ei.value === 19 && await bossOpLogOn(db, ctxG) === true, '重新开启 → 恢复 53/19');

  /* M29.5 自评偏差：自评(40/70/80/85) vs 实测(53/19/—/51) → DVI 缺按 3 项均值 = 33 */
  await submitSelfRating(db, ctxG, { ratings: { sii: 40, ei: 70, dvi: 80, ahc: 85 } });
  const dev = await selfDeviation(db, ctxG);
  ok(dev.gap === 33 && dev.rows.length === 3,
    `自评偏差 = round((13+51+34)/3) = 33，DVI 缺 → 3 项均值（实际 ${dev.gap}/${dev.rows.length} 项）`);
}

/* ================= ②③ 钱途页 salesBundle（A-08/A-09 机检）+ 老板端 bundle ================= */
console.log('— ②③ salesBundle 七栏 + 🔴 A-08/A-09 正则机检 + AHC 销售端渲染 —');
{
  const b = await salesBundle(db, ctxG, { spId: 'G1' });
  ok(b.bossCredit.ahc === 51 && b.bossCredit.four.length === 4,
    `⑤栏 老板的信用：AHC=51 + 四拆解渲染（L-D2 销售端渲染）`);
  ok(b.bossCredit.interceptRecords.length === 4 && b.bossCredit.interceptRecords[0].at === '2026-06-01',
    `⑤栏 拦截记录 4 条全员可见（实际 ${b.bossCredit.interceptRecords.length}）`);
  ok(b.bossCredit.note === 'ⓘ 这个分数由系统计算，老板改不了', '⑤栏 固定说明逐字（16.6）');
  ok(b.now.baseSalaryAmt === 3000000 && b.now.myCollectedAmt === 0 && b.record.length === 6,
    '①现在（底薪+本人回款）+ ⑥战绩（近6月本人回款）');
  ok(b.next === null && b.ladder === null, '②③ 无当期方案版本 → "—"（null，不硬造）');
  ok(b.channels.objection === true && b.channels.suggestion === true, '⑦ 底部 M30 双通道入口');

  const s = JSON.stringify(b);
  ok(!/grossMargin|netContribution|laborRoi|aov|scissors|discountLeak|uer|rank|peerCompare|redAlert/i.test(s),
    '🔴 A-08/A-09 正则零命中（毛利/净利/laborRoi/客单/剪刀差/折扣泄漏/UER/排名/对比/红色预警）');
  ok(/myCollected/.test(s), '唯一豁免：本人回款字段名 myCollected（A-08 豁免命名）');

  const bb = await bossBundle(db, ctxG);
  ok(bb.indices.ahc.value === 51 && bb.talk.locked === true && bb.talk.code === 'A11_LOCKED',
    `bossBundle 全量：AHC 只读=51；未 runM21 → 该谈名单诚实锁定（A-11 不放水）`);
  ok(bb.bossOpLogOn === true && bb.selfDeviation.gap === 33, 'bossBundle 含开关明示 + 自评偏差');
}

/* ================= ② irrevocable（tP：L-D1 / T12） ================= */
console.log('— ② irrevocable：tryDowngrade 无成功路径（留痕+AHC降）+ 触发器双保险 —');
{
  await mkSp(ctxP, 'M');
  await put(db, ctxP, 'ledger_entries', { id: 'lp1', employee_id: 'M', category: 'mentoring_share',
    promise_text: '带教分成', achieved_at: '2026-06-01', honored_at: '2026-06-15' }, 'ledger_entry_appended');
  await put(db, ctxP, 'ledger_entries', { id: 'lp2', employee_id: 'M', category: 'mentoring_share',
    promise_text: '带教分成', achieved_at: '2026-06-01' }, 'ledger_entry_appended');
  await createM28(db, ctxP, { id: 'm28_1', masterId: 'M', kind: 'mentoring',
    rate: 0.05, durationMonths: 12, startTrigger: 'apprentice_ramp_done' });
  const r0 = await computeIndices(db, ctxP);
  ok(r0.ahc.value === 55, `tP 基线 AHC = 40×0.5+0+20+15 = 55（实际 ${r0.ahc.value}）`);

  const before = await q(`select rate::float8 as rate, duration_months, irrevocable, baseline_snapshot_amt
    from m28_agreements where tenant_id = $1 and id = 'm28_1'`, [tP]);
  const rd = await tryDowngrade(db, ctxP, { m28Id: 'm28_1', note: '想降到 3%' });
  ok(rd.ok === false && rd.reason === 'irrevocable_blocked' && rd.downgraded === false,
    '🔴 tryDowngrade → ok:false（下调无代码成功路径）');
  ok(rd.ahcBefore === 55 && rd.ahcAfter === 53 && rd.ahcBefore > rd.ahcAfter,
    `AHC 重算下降：55 → 53（拦截 1 次 = −2 分；实际 ${rd.ahcBefore}→${rd.ahcAfter}）`);
  const after = await q(`select rate::float8 as rate, duration_months, irrevocable, baseline_snapshot_amt
    from m28_agreements where tenant_id = $1 and id = 'm28_1'`, [tP]);
  ok(JSON.stringify(before) === JSON.stringify(after) && near(after[0].rate, 0.05) && after[0].duration_months === 12,
    '🔴 m28_agreements 行零改动（rate/duration/irrevocable/快照原样）');
  const ov = await q(`select action, m28_id, visible_to_all from override_events where tenant_id = $1`, [tP]);
  ok(ov.length === 1 && ov[0].action === 'try_downgrade' && ov[0].m28_id === 'm28_1' && ov[0].visible_to_all === true,
    'override_events +1（B 形留痕，全员可见）');
  ok((await q(`select count(*)::int as n from boss_op_logs where tenant_id = $1 and action = 'try_downgrade'`, [tP]))[0].n === 1,
    'boss_op_logs try_downgrade +1（🔴 P-2：count 为 AHC 真源）');
  const [dsAhc] = await q(`select value_num::float8 as v from derived_scalars
    where tenant_id = $1 and scope = 'tenant' and key = 'ahc' order by period desc, computed_at desc limit 1`, [tP]);
  ok(Number(dsAhc.v) === 53, '重算 AHC 已落表（derived_scalars = 53，全员读侧立即可见）');

  const nf = await tryDowngrade(db, ctxP, { m28Id: 'nope' });
  ok(nf.ok === false && nf.reason === 'not_found'
    && (await q(`select count(*)::int as n from override_events where tenant_id = $1`, [tP]))[0].n === 1,
    'not_found → 拒且零留痕（不误扣 AHC）');

  /* 🔴 触发器双保险：直接 SQL 下调/删除均无成功路径 */
  let e1 = null, e2 = null, e3 = null;
  try { await db.query(`update m28_agreements set rate = 0.03 where tenant_id = $1 and id = 'm28_1'`, [tP]); } catch (e) { e1 = e.message; }
  try { await db.query(`update m28_agreements set duration_months = 6 where tenant_id = $1 and id = 'm28_1'`, [tP]); } catch (e) { e2 = e.message; }
  try { await db.query(`delete from m28_agreements where tenant_id = $1 and id = 'm28_1'`, [tP]); } catch (e) { e3 = e.message; }
  ok(e1 != null && /no success path/.test(e1), `SQL rate 下调 → 触发器拒（${(e1 || '').slice(0, 40)}…）`);
  ok(e2 != null && /no success path/.test(e2), 'SQL duration 缩短 → 触发器拒');
  ok(e3 != null && /no success path/.test(e3), 'SQL DELETE → 触发器拒');

  /* 产权看板：3.48 万对价 vs 一次性 500 → 69.6 倍（T6） */
  const board = await m28Board(db, ctxP, { monthlyAmtById: { m28_1: 5800000 } });
  ok(board.rows[0].valueAmt === 3480000 && near(board.rows[0].vsOneOff, 69.6),
    `m28Board：5.8万×5%×12 = 3.48万，vs 500 一次性 = 69.6 倍（实际 ${board.rows[0].valueAmt}/${board.rows[0].vsOneOff}）`);
}

/* ---------- tT 种子：留存引擎（价签/守护线/该谈/M37） ---------- */
await mkCat(ctxT, 'cat0', 0.5);
await mkSp(ctxT, 'PY', { hireDate: '2023-10-01', baseAmt: 3000000 });
await mkSp(ctxT, 'W', { hireDate: '2024-01-10', baseAmt: 2500000 });
await mkSp(ctxT, 'V', { hireDate: '2023-03-15', baseAmt: 4000000 });
await mkSp(ctxT, 'AN', { hireDate: '2025-07-20', baseAmt: 4000000 });
await mkSp(ctxT, 'PT', { hireDate: '2024-01-01', baseAmt: 4000000 });
await mkSp(ctxT, 'NEW', { hireDate: '2026-05-01', baseAmt: 4000000 });
await createPlanVersion(db, ctxT, { inputs: {}, rRate: 0.2, matrixTAmt: 3000000, effectiveFrom: '2026-01-01' });
for (const m of ['2026-04', '2026-05', '2026-06', '2026-07']) await mkNorm(ctxT, 'W', m, 2);
await mkNorm(ctxT, 'V', '2026-05', 1); await mkNorm(ctxT, 'V', '2026-06', 2); await mkNorm(ctxT, 'V', '2026-07', 2);
await mkNorm(ctxT, 'PY', '2026-07', 1); await mkNorm(ctxT, 'PT', '2026-07', 3);
/* PY：前3月毛利 3000万、近3月 3801万 → 贡献增长率恰 26.7% */
let dn = 0;
for (const d of ['2026-02-10', '2026-03-10', '2026-04-10']) await mkDeal(ctxT, `dp${++dn}`, 'PY', d, 20000000);
for (const d of ['2026-05-10', '2026-06-10', '2026-07-05']) await mkDeal(ctxT, `dp${++dn}`, 'PY', d, 25340000);
for (const d of ['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-05'])
  await mkDeal(ctxT, `dt${++dn}`, 'PT', d, 20000000);
await mkDeal(ctxT, `dn${++dn}`, 'NEW', '2026-06-10', 20000000);
await mkDeal(ctxT, `dn${++dn}`, 'NEW', '2026-07-05', 20000000);
await mkPayout(ctxT, 'pe1', 'PY', '2025-08-15', 'year_end_bonus', 3000000);

/* ================= ④ M37 三态（T13） ================= */
console.log('— ④ M37 参照点预检：历史 3 万 / 增长 26.7% → 趋势 38000；三态 🔴🟡🟢 —');
{
  const r1 = await payoutPrecheckFor(db, ctxT, { spId: 'PY', plannedAmt: 2800000 });
  ok(near(r1.growth, 0.267) && r1.hist === 3000000 && r1.trend === 3800000,
    `历史 30,000 × (1+26.7%) → 趋势 38,000（取整百元；实际 hist=${r1.hist} trend=${r1.trend} g=${r1.growth}）`);
  ok(r1.verdict === 'below_history', `拟发 28,000 < 历史 → 🔴 below_history（L-10a）`);
  const r2 = await payoutPrecheckFor(db, ctxT, { spId: 'PY', plannedAmt: 3000000 });
  ok(r2.verdict === 'below_trend', '拟发 30,000 ∈ [历史, 趋势) → 🟡 below_trend（L-10b）');
  const r3 = await payoutPrecheckFor(db, ctxT, { spId: 'PY', plannedAmt: 3800000 });
  ok(r3.verdict === 'ok', '拟发 38,000 ≥ 趋势 → 🟢 ok（L-10c）');
  ok((await q(`select count(*)::int as n from payout_entries where tenant_id = $1`, [tT]))[0].n === 1,
    '🔴 L-D11：预检纯读——payout_entries 行数不变（不落库、不修改）');
}

/* ================= ⑦ 该谈名单（T15：榜眼 + 周年；2 月不触发） ================= */
console.log('— ⑦ 该谈名单：榜眼 连3月第2∧零特殊发放 触发 / 2 月不触发 / 周年 14 天内触发 —');
{
  const list = await talkListNow(db, ctxT);
  const byId = Object.fromEntries(list.map(x => [x.spId, x]));
  ok(byId.W != null && byId.W.triggers.some(t => t.src === 'second_place'),
    `榜眼档：W 归一排名连 3+ 月第 2 ∧ 滚12月零特殊发放 → 触发（L-09）`);
  const sp = byId.W.triggers.find(t => t.src === 'second_place').sp;
  ok(sp.months === 3 && sp.rank === 2 && sp.zeroSpecial === true,
    `榜眼证据：months=3 rank=2 zeroSpecial=true（实际 ${sp.months}/${sp.rank}/${sp.zeroSpecial}）`);
  ok(byId.V == null, 'V 仅连续 2 月第 2 → 不触发（连续 ≥3 月才入名单）');
  ok(byId.AN != null && byId.AN.triggers.some(t => t.src === 'anniversary'),
    `周年档：AN 周年 7 天后（≤14 天）→ 触发（实际 ${byId.AN?.triggers.map(t => t.src).join(',')}）`);
  ok(byId.PY == null, 'PY 剪刀差 0.16 < 30% ∧ 无市价样本 → 不触发（防疲劳不硬凑）');
}

/* ================= 附：守护线 + 价签（16.2 / 16.1） ================= */
console.log('— 附：守护线（totalIncome<矩阵T 连续≥2月）+ 价签 75 万与"不足回退" —');
{
  const g = await guardLine(db, ctxT);
  ok(g.matrixTAmt === 3000000 && JSON.stringify(g.months) === JSON.stringify(['2026-05', '2026-06']),
    `守护线窗口 = 近 2 个完整月 ${g.months.join('/')}，T=30,000（当期版本）`);
  ok(g.count === 1 && g.people[0].spId === 'W',
    `W 底薪 25,000 无提成 连 2 月 < T → 唯一插卡候选（实际 ${g.people.map(p => p.spId).join(',')}）`);
  ok(g.gRedefineHint === false, '跌破占比 1/6 ≤ 40% → 不触发"G 定错了"');

  const pt = await priceTagFor(db, ctxT, { spId: 'PT' });
  ok(pt.headline === 75000000 && pt.monthsUsed === 6,
    `价签 headline = 1000万/月毛利 ×(1.5+6) = 75 万（实际 ${pt.headline / 1e6} 万）`);
  ok(near(pt.rampGapMonthsEq, 5.78, 0.001) && pt.hitGate5 === true,
    `爬坡月当量 = 5.78（公约 §4.7 曲线实算，D-C1-1）∧ 占比 77.1% 触闸⑤`);
  ok(pt.items.find(i => i.key === 'handover').amt === null,
    '第⑥项无具名 HandoverCard → null（"—"，急性项不硬造）');
  const ptNew = await priceTagFor(db, ctxT, { spId: 'NEW' });
  ok(ptNew.monthsUsed === 3 && ptNew.gm === Math.round(20000000 / 3),
    `在职不足 6 月 → 月均毛利按在职 3 月回退（gm=${ptNew.gm}）`);
}

/* ---------- tO 种子：离职余震 ---------- */
await mkCat(ctxO, 'cat0', 0.5);
await mkSp(ctxO, 'L', { hireDate: '2024-01-01', cityTier: 'tier1', hireBatchId: 'b1' });
await mkSp(ctxO, 'P1', { cityTier: 'tier1', hireBatchId: 'b2' });
await mkSp(ctxO, 'P2', { cityTier: 'tier2', hireBatchId: 'b1' });
await mkSp(ctxO, 'P3', { cityTier: 'tier2', hireBatchId: 'b2' });
await mkNorm(ctxO, 'L', CUR, 1, 1.7);
await mkNorm(ctxO, 'P1', CUR, 2); await mkNorm(ctxO, 'P2', CUR, 3); await mkNorm(ctxO, 'P3', CUR, 4);
{
  let n = 0;
  for (const d of ['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-05'])
    await mkDeal(ctxO, `dl${++n}`, 'L', d, 20000000);
  for (const p of ['P1', 'P2', 'P3']) {
    await mkDeal(ctxO, `da_${p}`, p, '2026-04-10', 18000000);      // 前3月毛利 900万
    await mkDeal(ctxO, `db_${p}`, p, '2026-06-10', 24000000);      // 近3月毛利 1200万 → 剪刀差>0
  }
}

/* ================= ⑤ M38 离职余震与交接损耗（T14） ================= */
console.log('— ⑤ M38：离职登记 → 3 张 talk 卡（2/2/1 排序）→ 11 单 96 万 → 38.4/19.2 万 —');
{
  const radar = await dependencyRadarNow(db, ctxO);
  ok(near(radar.value, 120e6 / 246e6, 1e-9) && radar.band === 'warning' && radar.selfMade === true,
    `依赖度雷达：Top1=L 占 ${Math.round(radar.value * 1000) / 10}% 🟡 ∧ leadIndex 1.7>1.5 → 地盘校正提示`);

  const r = await offboard(db, ctxO, { spId: 'L', leaveDate: TEST_TODAY, leaveReason: 'resign_salary' });
  const [sp] = await q(`select is_active, leave_date::text as ld, leave_reason from salespersons
    where tenant_id = $1 and id = 'L'`, [tO]);
  ok(sp.is_active === false && sp.ld === TEST_TODAY && sp.leave_reason === 'resign_salary',
    '离职登记：salespersons patch（is_active/leave_date/leave_reason）');
  ok(r.aftershock.length === 3
    && r.aftershock.map(x => x.spId).join(',') === 'P1,P2,P3'
    && r.aftershock.map(x => x.score).join(',') === '2,2,1',
    `余震 Top3 按三信号 2/2/1 排序（P1 同城/P2 同批次/P3 仅剪刀差；实际 ${r.aftershock.map(x => x.spId + ':' + x.score).join(' ')}）`);
  const cards = await q(`select kind, state, target_id, payload from action_cards where tenant_id = $1 order by card_id`, [tO]);
  ok(cards.length === 3 && cards.every(c => c.kind === 'talk' && c.state === 'pending'),
    'action_card(kind=talk, pending) 恰 3 张（一周内每人一次一对一，L-11）');

  let n = 0, ids = [];
  for (let i = 1; i <= 6; i++) { await addHandoverCard(db, ctxO, { id: `hc${++n}`, leaverId: 'L', clientName: `客户${n}`, stage: 'hot', amountAmt: 10000000 }); ids.push(`hc${n}`); }
  for (let i = 1; i <= 5; i++) { await addHandoverCard(db, ctxO, { id: `hc${++n}`, leaverId: 'L', clientName: `客户${n}`, stage: 'warm', amountAmt: 7200000 }); ids.push(`hc${n}`); }
  const hs = await handoverSummaryFor(db, ctxO, { leaverId: 'L' });
  ok(hs.count === 11 && hs.sum === 96000000, `11 张交接卡合计 96 万（实际 ${hs.count} 张/${hs.sum / 1e6} 万分位）`);
  ok(hs.loss === 38400000 && hs.save === 19200000,
    `交接损耗 = 96×40% = 38.4 万；可救 = ×50% = 19.2 万（实际 ${hs.loss / 1e6}/${hs.save / 1e6}）`);

  /* 价签第⑥项读侧回填（L-D15：⑤慢性 35% 与 ⑥急性 40% 不双计同一笔） */
  const pt = await priceTagFor(db, ctxO, { spId: 'L' });
  const i5 = pt.items.find(i => i.key === 'decay'), i6 = pt.items.find(i => i.key === 'handover');
  ok(i6.amt === 38400000, `价签第⑥项 = M38 实际值回填 38.4 万（实际 ${i6.amt / 1e6}）`);
  ok(i5.amt === Math.round(10000000 * 0.35) && i5.amt !== i6.amt,
    '第⑤项仍为管道整体 35%（慢性）——⑤⑥ 各算各的，不双计同一笔');

  /* 🔴 L-D12：交接卡无删除路径 */
  let de = null;
  try { await db.query(`delete from handover_cards where tenant_id = $1 and id = 'hc1'`, [tO]); } catch (e) { de = e.message; }
  ok(de != null && /no success path/.test(de), `handover_cards DELETE → 触发器拒（${(de || '').slice(0, 40)}…）`);
}

/* ================= ⑥ M30 双通道：真匿名 + sweep + EI 实时变 ================= */
console.log('— ⑥ M30：匿名真匿名 / 异议不可匿名 / pending>7 天 sweep 失效 / EI 随提交实时变 —');
{
  const ei = async () => (await computeIndices(db, ctxG)).ei.value;
  ok(await ei() === 19, 'EI 基线 = 19（异议 0 / 建议 0）');

  /* 异议①（业务日 2026-07-01 → 到 TEST_TODAY 已 12 天） */
  const o1 = await raiseObjection(db, { ...ctxG, today: '2026-07-01' },
    { employeeId: 'G2', targetType: 'bad_debt', targetId: 'bd_9' });
  ok(await ei() === 25, `异议 +1 → EI 分母实时变：30×(1/5)=6 → EI=25`);

  let anonErr = null;
  try { await raiseObjection(db, ctxG, { targetType: 'bad_debt' }); } catch (e) { anonErr = e.message; }
  ok(anonErr != null && /不可匿名/.test(anonErr), '🔴 异议不可匿名（employeeId 必填，件二铁律）');

  /* 匿名建议：employee_id 与 created_by 均 null；事件 actor=哨兵、payload 零 actor 标识 */
  const s1 = await raiseSuggestion(db, ctxG, { category: 'process', content: '审批太慢', anonymous: true });
  const [srow] = await q(`select employee_id, created_by from suggestion_entries where tenant_id = $1 and id = $2`, [tG, s1.sugId]);
  ok(srow.employee_id === null && srow.created_by === null,
    '🔴 匿名真匿名：suggestion_entries.employee_id 与 created_by 均 null');
  const [sev] = await q(`select actor_id, payload from event_stream
    where tenant_id = $1 and type = 'suggestion_raised' order by event_id desc limit 1`, [tG]);
  const pj = typeof sev.payload === 'string' ? JSON.parse(sev.payload) : sev.payload;
  ok(sev.actor_id === ANON_ACTOR && !('employeeId' in pj) && !('actorId' in pj) && pj.createdBy === null,
    '🔴 事件 payload 零 actor 标识；actor_id = 匿名哨兵（非任何成员）');
  ok(await ei() === 25, '匿名建议仍计 EI 分母（提出 1 采纳 0 → 采纳率 0，EI 不变=25）');
  await resolveSuggestion(db, ctxG, { sugId: s1.sugId, decision: 'adopted' });
  ok(await ei() === 50, `采纳 → 采纳率 1 → EI = 6+25+15+4 = 50（实时变）`);

  /* 异议②（当日）→ EI 再变；sweep 只失效超 7 天的 ① */
  const o2 = await raiseObjection(db, ctxG, { employeeId: 'G3', targetType: 'stop_bleed', targetId: 'sb_1' });
  ok(await ei() === 56, `异议 +1 → 30×(2/5)=12 → EI=56`);
  const sw = await sweepObjections(db, ctxG);
  ok(sw.count === 1 && sw.flippedIds[0] === o1.objId,
    `sweep：pending>7 天恰 1 条失效（${o1.objId}；当日的 ${o2.objId} 不动）`);
  const rows = await q(`select id, status, mark_active from objection_entries where tenant_id = $1 order by id`, [tG]);
  const m = Object.fromEntries(rows.map(r => [r.id, r]));
  ok(m[o1.objId].mark_active === false && m[o1.objId].status === 'pending',
    '失效 = mark_active=false（默认保护员工）；异议本身仍 pending（老板必处理不豁免）');
  ok(m[o2.objId].mark_active === true, '未超期异议 mark_active 原样');
  await resolveObjection(db, ctxG, { objId: o2.objId, decision: 'upheld' });
  ok((await q(`select status from objection_entries where tenant_id = $1 and id = $2`, [tG, o2.objId]))[0].status === 'upheld',
    '老板处理 [维持原判] → status=upheld + resolved_at');
}

/* ================= ⑧ 事件双写抽查 ================= */
console.log('— ⑧ 事件双写抽查 —');
{
  ok(await esType(tP, 'm28_signed') === 1 && await esType(tP, 'm28_downgrade_intercepted') === 1,
    'tP：m28_signed=1 / m28_downgrade_intercepted=1');
  ok(await esType(tP, 'boss_op_logged') === 1, 'tP：boss_op_logged=1（P-2 拦截计数落 boss_op_logs）');
  ok(await esType(tG, 'objection_raised') === 2 && await esType(tG, 'objection_resolved') === 1
    && await esType(tG, 'objection_mark_expired') === 1,
    'tG：objection_raised=2 / resolved=1 / mark_expired=1');
  ok(await esType(tG, 'suggestion_raised') === 1 && await esType(tG, 'suggestion_resolved') === 1,
    'tG：suggestion_raised=1 / suggestion_resolved=1');
  ok(await esType(tG, 'boss_op_log_toggled') === 2 && await esType(tG, 'boss_self_rated') === 1,
    'tG：boss_op_log_toggled=2（关+开）/ boss_self_rated=1');
  ok(await esType(tG, 'derived_scalar_written') >= 4 * 8, `tG：derived_scalar_written ≥ 32（每次 computeIndices 4 行双写）`);
  ok(await esType(tO, 'salesperson_offboarded') === 1 && await esType(tO, 'talk_card_created') === 3
    && await esType(tO, 'handover_card_added') === 11,
    'tO：offboarded=1 / talk_card_created=3 / handover_card_added=11');
}

await db.close();

/* ================= ⑨ 回归：C2–C7 不受影响 ================= */
console.log('— ⑨ 回归：spawnSync 跑 c2-model / c3 / c4 / c5 / c6 / c7 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs', 'c4.test.mjs', 'c5.test.mjs', 'c6.test.mjs', 'c7.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 600000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C8 信用层验收全部通过');
process.exit(failures ? 1 : 0);
