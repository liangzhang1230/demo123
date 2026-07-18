#!/usr/bin/env node
/* C4 招聘链验收（v5.1 §12 C4 行：M3–M6、M8）：
   ① 查重三例（拒/拒/放行+warn，断言脱敏 姓+* / 138****XX 与离职详情）
   ② 坏账 90 天切割：hire+60 离职(resign_other)→坏账+recruiter；hire+100→manager；
      layoff hire+30→不计；坏账率分母=窗口期满（hire+90≤today）入职数（手算对照）
   ③ 四灯阈值对拍：offerAccept 0.65🟢/0.5🟡/0.3🔴、noshow 0.12🟢/0.2🟡/0.35🔴、
      poachShare 0🟢/0.1🟡/0.35🔴、cycleWorse +25%🟡/+60%🔴、样本<3 grey（逐值对照系数）
      + tempLights 全流程对拍（事件流复算）
   ④ 五池只前进一格：resume→offer 跳池拒；offer 流失(salary_gap)→自动 reserve+渠道改写
      + 停滞三色红>橙>黄排序 + 姓名脱敏按角色
   ⑤ 蓄水池：35天未触达→待触达；95天→红；触达后移出；市价 4样本→null、5样本→median
   ⑥ hired 转池：Employee 建档回链 + interview_score_packs 明细销毁断言（Z-D1）
      + M6 vintage：存活曲线 / 回本日 / 死亡归因三切片（<3 置灰）
   ⑦ 事件双写抽查：以上写操作 event_stream 逐笔 +N 对账
   ⑧ 回归：spawnSync 跑 c2-model 与 c3
   时钟注入（公约 C-14/R-11）：TEST_TODAY=2026-07-13，服务层零 new Date() */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCoef, addDays } from '../domain/shared.mjs';
import { put } from '../server/writes.mjs';
import { createCandidate, movePool, hireCandidate, pendingList } from '../server/m3.mjs';
import { touchCandidate, reserveBoard, marketPrice } from '../server/m4.mjs';
import { badDebt90, responsibilityOf, isBadDebt } from '../server/m5.mjs';
import { survival, paybackDay, deathSlices } from '../server/m6.mjs';
import { tempLights, offerAcceptLight, noshowLight, cycleWorseLight, poachShareLight } from '../server/m8.mjs';
import { createPlanVersion } from '../server/m2.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));      // cloud/
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps;

const TEST_TODAY = '2026-07-13';                 // 公约 C-14/R-11：与五板块对拍同一基准日

/* ================= ⓪ 静态断言：C4 服务层零 new Date() ================= */
console.log('— ⓪ 静态断言：C4 服务层零 new Date()（公约 C-14 时钟注入） —');
{
  const clockHits = ['server/m3.mjs', 'server/m4.mjs', 'server/m5.mjs', 'server/m6.mjs', 'server/m8.mjs']
    .filter(f => /new Date\(/.test(readFileSync(join(root, f), 'utf8')));
  ok(clockHits.length === 0, 'm3–m8 零 new Date()（业务日期一律 ctx.today）', clockHits.join(','));
}

/* ================= 环境：PGlite + schema 四段执行 ================= */
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
await db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c2.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c3.sql'), 'utf8'));
await db.exec(readFileSync(join(root, 'db', 'schema-c4.sql'), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to app_user;
  grant usage, select on all sequences in schema public to app_user;
  revoke update, delete on event_stream from app_user;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const U = { boss: 'a0000000-0000-4000-8000-00000000000a' };
const mkTenant = async name => (await q(`insert into tenants(name, created_by) values ($1, $2) returning id`, [name, U.boss]))[0].id;
const tA = await mkTenant('C4·漏斗');       // ①④⑥（查重/五池/hired 转池）
const tB = await mkTenant('C4·蓄水池');     // ⑤
const tC = await mkTenant('C4·坏账');       // ②
const tD = await mkTenant('C4·vintage');    // ⑥b
const tE = await mkTenant('C4·四灯');       // ③
const CTX = t => ({ tenantId: t, actorId: U.boss, today: TEST_TODAY });
const ctxA = CTX(tA), ctxB = CTX(tB), ctxC = CTX(tC), ctxD = CTX(tD), ctxE = CTX(tE);
const es = async t => (await q(`select count(*)::int as n from event_stream where tenant_id = $1`, [t]))[0].n;

/* ================= ① 查重三例（闸⑦，2号 T22 云端复刻） ================= */
console.log('— ① 查重三规则（闸⑦）：拒 / 拒 / 放行+warn —');
{
  await put(db, ctxA, 'salespersons', { id: 'spOn', name: '王在职', phone: '13900000022', level: 'sales', hire_date: '2025-01-01', is_active: true }, 'salesperson_created');
  await put(db, ctxA, 'salespersons', { id: 'spOff', name: '赵离职', phone: '13700000033', level: 'sales', hire_date: '2024-06-01', leave_date: '2025-08-15', leave_reason: 'resign_other', is_active: false }, 'salesperson_created');

  const e0 = await es(tA);
  const c1 = await createCandidate(db, ctxA, { id: 'cA1', name: '张三', phone: '13800000011', positionName: '销售', sourceChannel: 'boss_zhipin', recruiterName: '王五' });
  ok(c1.warn == null && c1.pool === 'resume', '新号建档放行，入 resume 池');
  ok(await es(tA) === e0 + 1, '⑦ 建档事件双写 +1（candidate_created）');

  let err = null;   // 规则一：候选人表内 phone 重复 → 拒，报错含脱敏 姓+* / 前三后二
  try { await createCandidate(db, ctxA, { id: 'cA2', name: '李四', phone: '13800000011', sourceChannel: 'liepin' }); } catch (e) { err = e.message; }
  ok(err != null && err.includes('张*') && err.includes('138****11'),
    `规则一 表内重复拒 + 脱敏（姓+* / 138****XX）：${err}`, err || '（竟然放行）');
  ok((await q(`select count(*)::int as n from candidates where tenant_id=$1 and phone='13800000011'`, [tA]))[0].n === 1, '规则一拦截后行数不变 = 1');

  err = null;       // 规则二：与在职 salesperson 重复 → 拒
  try { await createCandidate(db, ctxA, { id: 'cA2', name: '李四', phone: '13900000022', sourceChannel: 'liepin' }); } catch (e) { err = e.message; }
  ok(err != null && err.includes('在职'), `规则二 与在职员工重复拒：${err}`, err || '（竟然放行）');

  // 规则三：与离职重复 → 放行 + warn（含 曾于{年月}在职 + 原因枚举）
  const e1 = await es(tA);
  const c3r = await createCandidate(db, ctxA, { id: 'cA3', name: '孙六', phone: '13700000033', sourceChannel: 'referral' });
  ok(c3r.warn != null && c3r.warn.includes('2025-08') && c3r.warn.includes('resign_other'),
    `规则三 与离职重复放行 + warn（曾于 2025-08 在职，原因 resign_other）：${c3r.warn}`);
  ok((await q(`select count(*)::int as n from candidates where tenant_id=$1 and id='cA3'`, [tA]))[0].n === 1, '规则三已实际建档');
  ok(await es(tA) === e1 + 1, '⑦ 规则三建档事件 +1');
}

/* ================= ④ 五池只前进一格 + 流失分流 + 停滞排序 ================= */
console.log('— ④ 五池 ZE-01：跳池拒 / 流失自动分流 / 停滞三色排序 —');
{
  await createCandidate(db, ctxA, { id: 'cB1', name: '周七', phone: '13600000044', sourceChannel: 'liepin' });
  let err = null;   // 跳池：resume → offer 拒
  try { await movePool(db, ctxA, { candId: 'cB1', to: 'offer' }); } catch (e) { err = e.message; }
  ok(err != null && err.includes('前进一格'), `跳池 resume→offer 被拒（ZE-01）：${err}`, err || '（竟然放行）');
  ok((await q(`select pool from candidates where tenant_id=$1 and id='cB1'`, [tA]))[0].pool === 'resume', '跳池被拒后仍在 resume');

  const e0 = await es(tA);
  await movePool(db, ctxA, { candId: 'cB1', to: 'interview_invite' });
  await movePool(db, ctxA, { candId: 'cB1', to: 'interview' });
  await movePool(db, ctxA, { candId: 'cB1', to: 'offer' });
  ok(await es(tA) === e0 + 3, '⑦ 前进三步事件 +3（candidate_pool_moved）');
  err = null;       // 回退：offer → interview 拒
  try { await movePool(db, ctxA, { candId: 'cB1', to: 'interview' }); } catch (e) { err = e.message; }
  ok(err != null, `回退 offer→interview 被拒：${err}`);

  // offer 流失(salary_gap，ZE-03) → 自动入 reserve + source_channel 改写 reserve_pool
  const e1 = await es(tA);
  const d1 = await movePool(db, ctxA, { candId: 'cB1', dropReason: 'salary_gap' });
  const [rB1] = await q(`select pool, source_channel, drop_reason from candidates where tenant_id=$1 and id='cB1'`, [tA]);
  ok(d1.autoReserve === true && rB1.pool === 'reserve', `offer 流失(salary_gap) → 自动入 reserve（实际 ${rB1.pool}）`);
  ok(rB1.source_channel === 'reserve_pool', `source_channel 自动改写 reserve_pool（ZE-04 系统打，实际 ${rB1.source_channel}）`);
  ok(rB1.drop_reason === 'salary_gap', 'drop_reason 落库 = salary_gap');
  ok(await es(tA) === e1 + 1, '⑦ 流失事件 +1（candidate_dropped）');

  // 硬淘汰（ZE-02）→ rejected，渠道不改
  await createCandidate(db, ctxA, { id: 'cB2', name: '吴八', phone: '13600000055', sourceChannel: 'boss_zhipin' });
  await movePool(db, ctxA, { candId: 'cB2', dropReason: 'resume_mismatch' });
  const [rB2] = await q(`select pool, source_channel from candidates where tenant_id=$1 and id='cB2'`, [tA]);
  ok(rB2.pool === 'rejected' && rB2.source_channel === 'boss_zhipin', `硬淘汰 resume_mismatch → rejected 渠道不改（实际 ${rB2.pool}/${rB2.source_channel}）`);

  // 简历池可回头流失 → 不入 reserve（简历池流失不入池）→ rejected
  await createCandidate(db, ctxA, { id: 'cB3', name: '郑九', phone: '13600000066', sourceChannel: 'other' });
  await movePool(db, ctxA, { candId: 'cB3', dropReason: 'timing_mismatch' });
  ok((await q(`select pool from candidates where tenant_id=$1 and id='cB3'`, [tA]))[0].pool === 'rejected',
    '简历池 ZE-03 流失不入 reserve → rejected（简历池流失不入池）');

  // 非法枚举拒
  await createCandidate(db, ctxA, { id: 'cB4', name: '冯十', phone: '13600000077', sourceChannel: 'other' });
  err = null;
  try { await movePool(db, ctxA, { candId: 'cB4', dropReason: 'bad_vibe' }); } catch (e) { err = e.message; }
  ok(err != null && err.includes('ZE-0'), `非法流失枚举被拒：${err}`);

  // 停滞三色 + 待推进排序（funnelStallDays：resume[3,6,9] / invite[5,10,15] / offer[3,6,9]）
  await put(db, ctxA, 'candidates', { id: 'st1', name: '停一', phone: '13500000055', source_channel: 'other', pool: 'resume', pool_entered_date: addDays(TEST_TODAY, -10) }, 'candidate_created');
  await put(db, ctxA, 'candidates', { id: 'st2', name: '停二', phone: '13500000056', source_channel: 'other', pool: 'interview_invite', pool_entered_date: addDays(TEST_TODAY, -12) }, 'candidate_created');
  await put(db, ctxA, 'candidates', { id: 'st3', name: '停三', phone: '13500000057', source_channel: 'other', pool: 'offer', pool_entered_date: addDays(TEST_TODAY, -4) }, 'candidate_created');
  const pl = await pendingList(db, ctxA);
  ok(pl.length === 3 && pl[0].candId === 'st1' && pl[0].light === 'red'
    && pl[1].candId === 'st2' && pl[1].light === 'orange'
    && pl[2].candId === 'st3' && pl[2].light === 'yellow',
    `待推进排序 红>橙>黄：${pl.map(x => `${x.candId}=${x.light}(${x.stallDays}d)`).join(' > ')}`);
  ok(pl[0].name === '停一', '老板视角姓名不脱敏');
  const plR = await pendingList(db, { ...ctxA, role: 'recruiter', recruiterName: '王五' });
  ok(plR.find(x => x.candId === 'st1')?.name === '停*', `招聘者视角非本人建档姓名脱敏 姓+*（实际 ${plR.find(x => x.candId === 'st1')?.name}）`);
}

/* ================= ⑥ hired 转池：建档回链 + 明细销毁（Z-D1 / T23） ================= */
console.log('— ⑥ hired 转池：Employee 回链 + interview_score_packs 明细销毁 —');
{
  await createCandidate(db, ctxA, { id: 'cH1', name: '洪八', phone: '13400000066', positionName: '销售', sourceChannel: 'liepin', recruiterName: '王五' });
  await movePool(db, ctxA, { candId: 'cH1', to: 'interview_invite' });
  await movePool(db, ctxA, { candId: 'cH1', to: 'interview' });
  // 评分包：八维 + darkTriad 明细类键（销毁对象）+ joltType + darkTriadScore 数值
  await put(db, ctxA, 'interview_score_packs', {
    id: 'pk1', cand_id: 'cH1',
    scores: { achievement: 80, cognitive: 70, integrity: 75, situational: 65, charisma: 40, experience: 50, adaptive: 70, darkTriad: 66, darkTriadDetail: { externalAttrib: 70, detailMissing: 60 } },
    dark_triad_score: 62, jolt_type: 'jolt', scored_date: '2026-06-20',
  }, 'score_pack_created');

  // offer 前不可 hire
  let err = null;
  try { await hireCandidate(db, ctxA, { candId: 'cH1', form: { stamp: 'X', name: '洪八', phone: '13400000066', hireDate: TEST_TODAY } }); } catch (e) { err = e.message; }
  ok(err != null && err.includes('offer'), `非 offer 池转 hired 被拒：${err}`);

  await movePool(db, ctxA, { candId: 'cH1', to: 'offer' });
  await put(db, ctxA, 'hire_batches', { id: 'bt1', label: '2026-Q3', member_ids: ['emp_X0'] }, 'hire_batch_created');
  const e0 = await es(tA);
  const h = await hireCandidate(db, ctxA, {
    candId: 'cH1',
    form: { stamp: 'H1', name: '洪八', phone: '13400000066', hireDate: '2026-07-01', hiringCostAmt: 1500000, startBaseSalaryAmt: 800000, batchId: 'bt1', mentorManagerName: 'MgrZ', cityTier: 'tier1' },
  });
  ok(h.employeeId === 'emp_H1' && h.packSealed === true, `转 hired 返回 employeeId=emp_H1、packSealed（实际 ${h.employeeId}/${h.packSealed}）`);
  const [sp] = await q(`select name, phone, hire_date::text as hd, hiring_cost_amt::float8 as hc, base_salary_amt::float8 as base, hire_batch_id, manager_id, source_channel, is_active from salespersons where tenant_id=$1 and id='emp_H1'`, [tA]);
  ok(sp != null && sp.hd.slice(0, 10) === '2026-07-01' && Number(sp.hc) === 1500000 && Number(sp.base) === 800000
    && sp.hire_batch_id === 'bt1' && sp.manager_id === 'MgrZ' && sp.is_active === true,
    'Employee 建档：hireDate/hiringCost/startBaseSalary/batch/mentor 全部落列');
  ok(sp.source_channel === 'liepin', `sourceChannel 自动带入候选人渠道（实际 ${sp.source_channel}）`);
  const [cd] = await q(`select pool, employee_id, score_pack_id from candidates where tenant_id=$1 and id='cH1'`, [tA]);
  ok(cd.pool === 'hired' && cd.employee_id === 'emp_H1' && cd.score_pack_id === 'pk1', `候选人回链：pool=hired / employee_id=emp_H1 / score_pack_id=pk1`);
  const [pk] = await q(`select scores, dark_triad_score::float8 as dts, jolt_type from interview_score_packs where tenant_id=$1 and id='pk1'`, [tA]);
  ok(pk.jolt_type === null, 'Z-D1：joltType 已销毁（null）');
  const keys = Object.keys(pk.scores).sort();
  ok(!keys.includes('darkTriad') && !keys.includes('darkTriadDetail') && keys.length === 7,
    `Z-D1：黑暗明细已销毁，scores 仅七维（实际 ${keys.join(',')}）`);
  ok(Number(pk.dts) === 62, `dark_triad_score 数值保留供 F12 匿名统计（实际 ${pk.dts}）`);
  const [bt] = await q(`select member_ids from hire_batches where tenant_id=$1 and id='bt1'`, [tA]);
  ok(Array.isArray(bt.member_ids) && bt.member_ids.includes('emp_H1') && bt.member_ids.includes('emp_X0'),
    `批次 member_ids 回填（实际 ${JSON.stringify(bt.member_ids)}）`);
  ok(await es(tA) === e0 + 4, '⑦ 转池事件 +4（salesperson_created + score_pack_sealed + candidate_hired + hire_batch_member_added）');
}

/* ================= ⑤ 蓄水池：待触达 / 红 / 触达移出 / 市价 ================= */
console.log('— ⑤ M4 蓄水池：≥30 待触达 / ≥90 红 / 触达移出 / 市价 median —');
{
  const mk = (id, name, phone, entered) => put(db, ctxB, 'candidates',
    { id, name, phone, position_name: '售前', source_channel: 'reserve_pool', pool: 'reserve', pool_entered_date: entered, drop_reason: 'timing_mismatch' }, 'candidate_created');
  await mk('r1', '甲一', '15000000001', addDays(TEST_TODAY, -35));   // 35 天 → 待触达
  await mk('r2', '乙二', '15000000002', addDays(TEST_TODAY, -95));   // 95 天 → 红
  await mk('r3', '丙三', '15000000003', addDays(TEST_TODAY, -10));   // 10 天 → ok
  let b = await reserveBoard(db, ctxB);
  const st = Object.fromEntries(b.items.map(i => [i.candId, i]));
  ok(st.r1.status === 'pending' && st.r1.sinceDays === 35, `35 天未触达 → 待触达（实际 ${st.r1.status}/${st.r1.sinceDays}d）`);
  ok(st.r2.status === 'red' && st.r2.sinceDays === 95, `95 天 → 红（实际 ${st.r2.status}/${st.r2.sinceDays}d）`);
  ok(st.r3.status === 'ok', `10 天 → 不进待办（实际 ${st.r3.status}）`);
  ok(b.pending.length === 2 && b.pending[0].candId === 'r2', `待办 2 人且红排前（实际 ${b.pending.map(x => x.candId).join(',')}）`);

  const e0 = await es(tB);
  await touchCandidate(db, ctxB, { id: 'tc1', candId: 'r1', channel: 'phone', note: '回访' });
  ok(await es(tB) === e0 + 2, '⑦ 触达事件 +2（candidate_touched + candidate_last_touch_updated）');
  const [tRow] = await q(`select touch_date::text as td, channel from candidate_touches where tenant_id=$1 and id='tc1'`, [tB]);
  ok(tRow != null && tRow.td.slice(0, 10) === TEST_TODAY && tRow.channel === 'phone', 'CandidateTouch 落库（touch_date=ctx.today）');
  b = await reserveBoard(db, ctxB);
  ok(b.items.find(i => i.candId === 'r1').status === 'ok' && b.pending.length === 1,
    '触达后 r1 移出待办（last_touch_date 生效），待办只剩红 r2');

  // 市价：近180天同岗 median；4 样本 → null；5 样本 → median；窗外样本不计
  const mp = (id, phone, amt, created) => put(db, ctxB, 'candidates',
    { id, name: id, phone, position_name: '销售顾问', expected_salary_amt: amt, source_channel: 'boss_zhipin', pool: 'resume', pool_entered_date: created, created_at: created }, 'candidate_created');
  await mp('mp0', '15100000000', 5000000, '2025-09-01');            // 窗外（>180天）不计
  await mp('mp1', '15100000001', 800000, '2026-05-01');
  await mp('mp2', '15100000002', 900000, '2026-05-02');
  await mp('mp3', '15100000003', 1000000, '2026-05-03');
  await mp('mp4', '15100000004', 1100000, '2026-05-04');
  let m = await marketPrice(db, ctxB, { positionName: '销售顾问' });
  ok(m.n === 4 && m.medianAmt === null, `4 样本 → null（窗外 mp0 不计；实际 n=${m.n} median=${m.medianAmt}）`);
  await mp('mp5', '15100000005', 1200000, '2026-05-05');
  m = await marketPrice(db, ctxB, { positionName: '销售顾问' });
  ok(m.n === 5 && m.medianAmt === 1000000, `5 样本 → median=1000000 分（实际 n=${m.n} median=${m.medianAmt}）`);
}

/* ================= ② M5 坏账 90 天切割 ================= */
console.log('— ② M5 坏账 90 天窗 + 责任切割（闸⑧） —');
{
  // 纯函数判定式
  ok(responsibilityOf('2026-03-11', '2026-01-10') === 'recruiter', '事件日 hire+60 → recruiter');
  ok(responsibilityOf('2026-04-10', '2026-01-10') === 'recruiter', '边界 hire+90 → recruiter（≤90 含端点）');
  ok(responsibilityOf('2026-04-11', '2026-01-10') === 'manager', 'hire+91 → manager');
  ok(isBadDebt('2026-03-11', '2026-01-10', 'resign_other') === true, 'hire+60 resign_other → 坏账');
  ok(isBadDebt('2026-04-20', '2026-01-10', 'resign_other') === false, 'hire+100 → 非坏账（>90）');
  ok(isBadDebt('2026-03-03', '2026-02-01', 'layoff') === false, 'layoff hire+30 → 🔴 不计坏账');

  const mk = (id, hd, ld = null, lr = null) => put(db, ctxC, 'salespersons',
    { id, name: id, level: 'sales', hire_date: hd, leave_date: ld, leave_reason: lr, is_active: ld == null }, 'salesperson_created');
  await mk('h0', '2025-06-01', '2025-07-01', 'resign_other');       // 滚12月窗外（hire < 2025-07-13）双排除
  await mk('h1', '2026-01-10', '2026-03-11', 'resign_other');       // hire+60 → 坏账 + recruiter
  await mk('h2', '2026-01-10', '2026-04-20', 'resign_other');       // hire+100 → 非坏账 + manager
  await mk('h3', '2026-02-01', '2026-03-03', 'layoff');             // layoff hire+30 → 不计坏账
  await mk('h4', '2026-03-01');                                     // 在职，窗口期满
  await mk('h5', '2026-06-01');                                     // hire+90 > today → 未期满，分母排除

  const r = await badDebt90(db, ctxC);
  const by = Object.fromEntries(r.items.map(i => [i.employeeId, i]));
  ok(by.h0 === undefined, '滚12月：h0（13 个月前入职）不入 cohort');
  ok(by.h1.badDebt === true && by.h1.responsibility === 'recruiter', `h1 hire+60 resign_other → 坏账 + recruiter（实际 ${by.h1.badDebt}/${by.h1.responsibility}）`);
  ok(by.h2.badDebt === false && by.h2.responsibility === 'manager', `h2 hire+100 → 非坏账 + manager（实际 ${by.h2.badDebt}/${by.h2.responsibility}）`);
  ok(by.h3.badDebt === false && by.h3.responsibility === 'recruiter', `h3 layoff → 不计坏账（切割仍 recruiter：${by.h3.responsibility}）`);
  ok(by.h5.matured === false, 'h5 hire+90 > today → 窗口未期满');
  ok(r.maturedCount === 4, `坏账率分母 = 窗口期满入职数 = 4（h1..h4，手算对照；实际 ${r.maturedCount}）`);
  ok(r.badCount === 1 && near(r.rate, 0.25), `坏账率 = 1/4 = 0.25（实际 ${r.badCount}/${r.maturedCount}=${r.rate}）`);
  ok(r.byRecruiter.length === 1 && near(r.byRecruiter[0].rate, 0.25), '招聘者聚合（无回链归 —）rate=0.25');
  const empty = await badDebt90(db, ctxB);
  ok(empty.rate === null, `样本不足（分母 ${empty.maturedCount} < 3）→ rate=null 不硬造`);
}

/* ================= ⑥b M6 vintage：存活 / 回本 / 三切片 ================= */
console.log('— ⑥b M6 vintage：存活曲线 / 回本日 / 死亡归因三切片 —');
{
  // 底薪档 B 取数源：comp_plan_versions 当期版本（inputs.baseSalaryAmt = 1000000 分）
  await createPlanVersion(db, ctxD, { inputs: { baseSalaryAmt: 1000000, cityTier: 'tier1' }, rRate: 0.20, effectiveFrom: '2025-01-01' });
  const mk = (id, hd, ld, lr, base, mgr) => put(db, ctxD, 'salespersons',
    { id, name: id, level: 'sales', hire_date: hd, leave_date: ld, leave_reason: lr, base_salary_amt: base, manager_id: mgr, is_active: ld == null }, 'salesperson_created');
  await mk('m1', '2025-06-01', null, null, 800000, 'MgrA');
  await mk('m2', '2025-06-01', '2025-07-15', 'resign_other', 800000, 'MgrA');    // 死于 44 天
  await mk('m3', '2025-06-05', '2025-12-01', 'resign_other', 800000, 'MgrB');    // 死于 179 天（90 存活）
  await mk('m4', '2025-06-10', null, null, 1300000, 'MgrB');
  await put(db, ctxD, 'hire_batches', { id: 'b1', label: '2025-Q2', member_ids: ['m1', 'm2', 'm3', 'm4'] }, 'hire_batch_created');

  const sv = await survival(db, ctxD, { batchId: 'b1' });
  ok(near(sv.s[30], 1) && near(sv.s[60], 0.75) && near(sv.s[90], 0.75) && near(sv.s[180], 0.5) && near(sv.s[360], 0.5),
    `S(t) 手算对照 {30:1, 60:0.75, 90:0.75, 180:0.5, 360:0.5}（实际 ${JSON.stringify(sv.s)}）`);
  await mk('m5b', '2026-05-01', null, null, 900000, 'MgrA');
  await put(db, ctxD, 'hire_batches', { id: 'b2', label: '2026-Q2', member_ids: ['m5b'] }, 'hire_batch_created');
  const sv2 = await survival(db, ctxD, { batchId: 'b2' });
  ok(near(sv2.s[30], 1) && sv2.s[90] === null && sv2.s[360] === null,
    `不满 t → null：b2 S(30)=1、S(90)=null、S(360)=null（实际 ${JSON.stringify(sv2.s)}）`);

  // 回本日：hire 2026-01-01，底薪 1000000 → 月 laborCost=1300000（+社保30%，🔒 shared.laborCost）
  //   hiringCost 1500000；deal 回款 10000000×0.5 毛利 5000000 落账 day30
  //   t=30 阈值 = 1500000 + 1300000×30/30 = 2800000 ≤ 5000000 → 回本日 30（t<30 累计 0）
  await mk('p1', '2026-01-01', null, null, 1000000, 'MgrA');
  await mk('p2', '2026-02-01', null, null, 1150000, 'MgrA');
  await put(db, ctxD, 'deals', { id: 'dP1', employee_id: 'p1', deal_date: '2026-01-31', payment_amt: 10000000, category_id: 'catX', margin_rate_snapshot: 0.5, status: 'won', paid_date: '2026-01-31' }, 'deal_created');
  const pb = await paybackDay(db, ctxD, { employeeId: 'p1' });
  ok(pb.monthlyLaborAmt === 1300000, `月 laborCost = 底薪+社保30% = 1300000（🔒 shared；实际 ${pb.monthlyLaborAmt}）`);
  ok(pb.paybackDay === 30, `回本日 = 30（手算对照；实际 ${pb.paybackDay}）`);
  const pb2 = await paybackDay(db, ctxD, { employeeId: 'p2' });
  ok(pb2.paybackDay === null, '无成交 → 回本日 null（不硬造）');

  // 三切片：总体=窗口期满（m5b 未满 90 排除）；B=1000000
  const ds = await deathSlices(db, ctxD);
  ok(ds.maturedCount === 6, `切片总体 = 窗口期满 6 人（m5b 排除；实际 ${ds.maturedCount}）`);
  const band = Object.fromEntries(ds.byBaseBand.map(g => [g.key, g]));
  ok(band['<B'].n === 3 && near(band['<B'].s90, 2 / 3) && band['<B'].grey === false,
    `<B 档 n=3 存活率 2/3（m2 死于 44 天；实际 ${band['<B'].s90}）`);
  ok(band['B~1.2B'].n === 2 && band['B~1.2B'].s90 === null && band['B~1.2B'].grey === true,
    'B~1.2B 档 n=2 < 3 → 置灰 null');
  ok(band['>1.2B'].n === 1 && band['>1.2B'].s90 === null && band['>1.2B'].grey === true, '>1.2B 档 n=1 → 置灰 null');
  const mon = Object.fromEntries(ds.byMonth.map(g => [g.key, g]));
  ok(mon['2025-06'].n === 4 && near(mon['2025-06'].s90, 0.75), `入职月切片 2025-06 n=4 s90=0.75（实际 ${mon['2025-06'].s90}）`);
  ok(mon['2026-01'].grey === true && mon['2026-02'].grey === true, '入职月样本 <3 置灰');
  const mgr = Object.fromEntries(ds.byMentor.map(g => [g.key, g]));
  ok(mgr.MgrA.n === 4 && near(mgr.MgrA.s90, 0.75) && mgr.MgrB.grey === true,
    `带教主管切片 MgrA n=4 s90=0.75、MgrB n=2 置灰（实际 ${mgr.MgrA.s90}/${mgr.MgrB.s90}）`);
}

/* ================= ③ M8 四灯阈值对拍 ================= */
console.log('— ③ M8 四灯：阈值逐值对照系数 + 判定对拍 + 全流程 —');
{
  // 系数逐值对照（getCoef('zhaoren.tempLightThresholds')，2号件二逐字）
  const thr = getCoef('zhaoren.tempLightThresholds');
  ok(thr.offerAccept[0] === 0.60 && thr.offerAccept[1] === 0.40, `offerAccept 阈值 [0.60,0.40]（实际 ${thr.offerAccept}）`);
  ok(thr.noshow[0] === 0.15 && thr.noshow[1] === 0.30, `noshow 阈值 [0.15,0.30]（实际 ${thr.noshow}）`);
  ok(thr.cycleWorse[0] === 0.20 && thr.cycleWorse[1] === 0.50, `cycleWorse 阈值 [0.20,0.50]（实际 ${thr.cycleWorse}）`);
  ok(thr.poachShare === 0.30, `poachShare 阈值 0.30（实际 ${thr.poachShare}）`);

  // 判定对拍（n=10 充足样本）
  ok(offerAcceptLight(0.65, 10) === 'green', 'offerAccept 0.65 → 🟢');
  ok(offerAcceptLight(0.50, 10) === 'yellow', 'offerAccept 0.50 → 🟡');
  ok(offerAcceptLight(0.30, 10) === 'red', 'offerAccept 0.30 → 🔴');
  ok(offerAcceptLight(0.60, 10) === 'green' && offerAcceptLight(0.40, 10) === 'yellow', '边界：0.60→🟢（≥60）、0.40→🟡（40–60）');
  ok(noshowLight(0.12, 10) === 'green', 'noshow 0.12 → 🟢');
  ok(noshowLight(0.20, 10) === 'yellow', 'noshow 0.20 → 🟡');
  ok(noshowLight(0.35, 10) === 'red', 'noshow 0.35 → 🔴');
  ok(noshowLight(0.15, 10) === 'yellow' && noshowLight(0.30, 10) === 'yellow', '边界：0.15/0.30 → 🟡（15–30 含端）');
  ok(cycleWorseLight(0.25, 10) === 'yellow', '周期恶化 +25% → 🟡');
  ok(cycleWorseLight(0.60, 10) === 'red', '周期恶化 +60% → 🔴');
  ok(cycleWorseLight(0.10, 10) === 'green' && cycleWorseLight(0.50, 10) === 'red', '边界：+10%→🟢、+50%→🔴（≥50）');
  ok(poachShareLight(0, 10) === 'green', 'poachShare 0 → 🟢（=0 才绿）');
  ok(poachShareLight(0.10, 10) === 'yellow', 'poachShare 0.10 → 🟡（>0）');
  ok(poachShareLight(0.35, 10) === 'red' && poachShareLight(0.30, 10) === 'red', 'poachShare 0.35/0.30 → 🔴（≥30%）');
  ok(offerAcceptLight(0.9, 2) === 'grey' && noshowLight(0.9, 2) === 'grey'
    && cycleWorseLight(0.9, 2) === 'grey' && poachShareLight(0.9, 2) === 'grey', '四灯样本 <3 → 一律 grey');

  // 全流程（tE，事件流复算；窗 [2026-04-14, 2026-07-13]）
  const at = d => ({ ...ctxE, today: d });
  const flow = async (id, phone, dates) => {   // dates = { create, invite, interview?, offer?, ... }
    await createCandidate(db, at(dates.create), { id, name: id, phone, sourceChannel: 'boss_zhipin' });
    await movePool(db, at(dates.invite), { candId: id, to: 'interview_invite' });
    if (dates.interview) await movePool(db, at(dates.interview), { candId: id, to: 'interview' });
    if (dates.offer) await movePool(db, at(dates.offer), { candId: id, to: 'offer' });
  };
  await flow('cE1', '15200000001', { create: '2026-04-20', invite: '2026-04-25', interview: '2026-05-01', offer: '2026-05-05' });
  await flow('cE2', '15200000002', { create: '2026-04-20', invite: '2026-04-26', interview: '2026-05-02', offer: '2026-05-06' });
  await flow('cE3', '15200000003', { create: '2026-04-21', invite: '2026-04-27', interview: '2026-05-03', offer: '2026-05-07' });
  await flow('cE4', '15200000004', { create: '2026-04-22', invite: '2026-04-28' });
  await movePool(db, at('2026-05-02'), { candId: 'cE4', dropReason: 'interview_noshow' });       // 爽约 1/4
  await hireCandidate(db, at('2026-05-10'), { candId: 'cE1', form: { stamp: 'E1', name: 'cE1', phone: '15200000001', hireDate: '2026-05-10', startBaseSalaryAmt: 800000 } });
  await hireCandidate(db, at('2026-05-12'), { candId: 'cE2', form: { stamp: 'E2', name: 'cE2', phone: '15200000002', hireDate: '2026-05-12', startBaseSalaryAmt: 800000 } });
  await movePool(db, at('2026-05-15'), { candId: 'cE3', dropReason: 'salary_gap' });             // Offer 流失 1
  const mkLeaver = (id, ld, lr) => put(db, ctxE, 'salespersons',
    { id, name: id, level: 'sales', hire_date: '2025-01-01', leave_date: ld, leave_reason: lr, is_active: false }, 'salesperson_created');
  await mkLeaver('L1', '2026-05-20', 'resign_salary');
  await mkLeaver('L2', '2026-06-01', 'resign_other');
  await mkLeaver('L3', '2026-06-10', 'probation_fail');

  const tl = await tempLights(db, ctxE, { windowDays: 90 });
  ok(tl.offerAccept.n === 3 && near(tl.offerAccept.value, 2 / 3) && tl.offerAccept.light === 'green',
    `全流程 offerAccept = 2/(2+1) = 0.667 → 🟢（实际 ${tl.offerAccept.value} ${tl.offerAccept.light}）`);
  ok(tl.noshow.n === 4 && near(tl.noshow.value, 0.25) && tl.noshow.light === 'yellow',
    `全流程 noshow = 1/4 约面 = 0.25 → 🟡（实际 ${tl.noshow.value} ${tl.noshow.light}）`);
  ok(tl.poachShare.n === 3 && near(tl.poachShare.value, 1 / 3) && tl.poachShare.light === 'red',
    `全流程 poachShare = 1/3 ≥ 30% → 🔴（实际 ${tl.poachShare.value} ${tl.poachShare.light}）`);
  ok(tl.cycleWorse.light === 'grey', `全流程 cycleWorse 前窗无样本 → grey（实际 ${tl.cycleWorse.light}）`);
}

await db.close();

/* ================= ⑧ 回归：C2 / C3 不受影响 ================= */
console.log('— ⑧ 回归：spawnSync 跑 c2-model 与 c3 —');
for (const f of ['c2-model.test.mjs', 'c3.test.mjs']) {
  const r = spawnSync('node', [join(root, 'tests', f)], { encoding: 'utf8', timeout: 300000 });
  ok(r.status === 0, `${f} 回归通过`,
    (r.stdout + r.stderr).split('\n').filter(l => l.includes('✗')).slice(0, 8).join(' | '));
}

console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C4 招聘链验收全部通过');
process.exit(failures ? 1 : 0);
