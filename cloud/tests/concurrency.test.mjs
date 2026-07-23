#!/usr/bin/env node
/* ============================================================
   对抗性安全 · B —— 高并发 + 乐观锁 + 数据一致性
   运行：node tests/concurrency.test.mjs
   🔴 前提如实声明：PGlite = 进程内单连接，查询串行执行。本套件测的是
      「逻辑并发正确性」——乐观锁语义 / 双写守恒 / 跨租户隔离 / 去重不撕裂，
      用 Promise.all 制造交错调度，不夸大为「网络级多连接并发」。
   ============================================================ */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, logEvent } from '../server/writes.mjs';
import { insertCard } from '../server/cardbus.mjs';
import { runM21 } from '../server/m21.mjs';
import { fold } from '../domain/replay.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };
const findings = [];   // 真实问题清单（系统缺陷/异常行为）
const TEST_TODAY = '2026-07-13';

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
const setUid = async u => { await db.query(`select set_config('app.uid', $1, false)`, [u]); };

/* 3 租户 + 各自 boss */
const bossOf = t => `${t}0000000-0000-4000-8000-00000000000${t}`;
const T = ['a', 'b', 'c'];
const tid = {};
for (const t of T) {
  const [{ id }] = await q(`insert into tenants(name, created_by) values ($1,$2) returning id`, [`租户${t}`, bossOf(t)]);
  tid[t] = id;
  await q(`insert into subscriptions(tenant_id) values ($1)`, [id]);
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [bossOf(t), id]);
  await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [id, bossOf(t)]);
  await q(`insert into suite_state(tenant_id, doc, updated_by) values ($1,'{"v":0}'::jsonb, $2)`, [id, bossOf(t)]);
}
const ctxOf = t => ({ tenantId: tid[t], actorId: bossOf(t), today: TEST_TODAY });

console.log('\n══════ B. 高并发 + 乐观锁 + 数据一致性（PGlite 单连接·逻辑并发） ══════');
const t0 = Date.now();

/* ============================================================
   ① N=100 并发 push_state 打同一 version → 恰 1 成功、99 冲突
   ============================================================ */
console.log('\n— ① 乐观锁：100 并发 push_state @ 同一 version —');
{
  await setUid(bossOf('a'));
  // 当前 version=1（建 suite_state 默认）
  const N = 100;
  const start = Date.now();
  const results = await Promise.all(Array.from({ length: N }, (_, i) =>
    q(`select push_state($1::jsonb, 1) as v`, [JSON.stringify({ writer: i })])
      .then(r => ({ ok: true, v: Number(r[0].v) }))
      .catch(e => ({ ok: false, err: e.message }))));
  const wins = results.filter(r => r.ok);
  const conflicts = results.filter(r => !r.ok && /version conflict/.test(r.err));
  const otherErr = results.filter(r => !r.ok && !/version conflict/.test(r.err));
  const [{ version, doc }] = await q(`select version, doc from suite_state where tenant_id=$1`, [tid.a]);
  ok(wins.length === 1, `恰 1 个 push_state 成功（实际 ${wins.length}）`, wins.length !== 1 ? '乐观锁失效' : '');
  ok(conflicts.length === N - 1, `其余 ${N - 1} 个 version conflict（实际 ${conflicts.length}）`);
  ok(otherErr.length === 0, `无异常错误（非冲突类 ${otherErr.length}）`, otherErr.map(e => e.err).slice(0, 3).join(';'));
  ok(Number(version) === 2, `最终 version=2（单调 +1，无跳号/无损坏，实际 ${version}）`);
  ok(doc && typeof doc === 'object' && 'writer' in doc, `doc 完整未撕裂（写入者 #${doc.writer}）`);
  if (wins.length !== 1) findings.push('push_state 乐观锁在并发下未保证唯一成功者');
  console.log(`    规模 ${N}｜成功 ${wins.length}｜冲突 ${conflicts.length}｜异常 ${otherErr.length}｜耗时 ${Date.now() - start}ms`);
}

/* ============================================================
   ② 并发 append_event
   ②a 单租户 RPC append_event ×500 → 精确 500，无丢写
   ②b 多租户交错（writes.logEvent 显式 ctx）→ 每租户精确、零跨租户串入
   ============================================================ */
console.log('\n— ② 并发 append_event：单租户无丢写 + 多租户零串库 —');
{
  await setUid(bossOf('a'));
  const before = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type='concur_a'`, [tid.a]))[0].n);
  const N = 500;
  const start = Date.now();
  const res = await Promise.all(Array.from({ length: N }, (_, i) =>
    q(`select append_event('concur_a', $1, $2::jsonb) as id`, [String(i), JSON.stringify({ i })])
      .then(() => true).catch(() => false)));
  const okc = res.filter(Boolean).length;
  const after = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type='concur_a'`, [tid.a]))[0].n);
  ok(okc === N && after - before === N, `RPC append_event ×${N} 精确落 ${N}（成功 ${okc}，增量 ${after - before}，零丢写）`);
  console.log(`    单租户 append ×${N}｜耗时 ${Date.now() - start}ms`);
}
{
  // 多租户交错：每租户 200 条，用 writes.logEvent（显式 ctx，事件流唯一插入口同构）
  const per = 200;
  const jobs = [];
  const expect = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < per * 3; i++) {
    const t = T[i % 3]; expect[t]++;
    jobs.push(logEvent(db, ctxOf(t), 'mt_evt', String(i), { i, t }));
  }
  const start = Date.now();
  await Promise.all(jobs);
  let crossLeak = 0;
  for (const t of T) {
    const n = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type='mt_evt'`, [tid[t]]))[0].n);
    ok(n === expect[t], `租户${t} mt_evt 精确 ${expect[t]}（实际 ${n}）`);
    // 该租户的 mt_evt payload.t 必恒为自己（无跨租户串入）
    const bad = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type='mt_evt' and payload->>'t' <> $2`, [tid[t], t]))[0].n);
    if (bad) crossLeak += bad;
  }
  ok(crossLeak === 0, `多租户交错 append 零跨租户串入（按 payload.t 对账）`, crossLeak ? `${crossLeak} 条串库` : '');
  if (crossLeak) findings.push('多租户并发 append 出现跨租户串入');
  console.log(`    多租户交错 append ×${per * 3}｜耗时 ${Date.now() - start}ms`);
}

/* ============================================================
   ③ 并发 writes.put 双写（表行+事件）多租户交错 → 每租户「表行数=事件数」守恒
   ============================================================ */
console.log('\n— ③ 并发双写守恒（表行数 == 事件数，无撕裂/无污染） —');
{
  const per = 150;
  const jobs = [];
  const expect = { a: 0, b: 0, c: 0 };
  let seq = 0;
  for (let i = 0; i < per * 3; i++) {
    const t = T[i % 3]; expect[t]++;
    const id = `cd_${t}_${seq++}`;
    jobs.push(put(db, ctxOf(t), 'deals',
      { id, employee_id: 'x', deal_date: '2026-07-01', payment_amt: 1000, category_id: 'c1' },
      'deal_created'));
  }
  const start = Date.now();
  const settled = await Promise.allSettled(jobs);
  const rejected = settled.filter(s => s.status === 'rejected').length;
  let torn = 0;
  for (const t of T) {
    const rows = Number((await q(`select count(*)::int n from deals where tenant_id=$1 and id like $2`, [tid[t], `cd_${t}_%`]))[0].n);
    const evts = Number((await q(`select count(*)::int n from event_stream where tenant_id=$1 and type='deal_created' and target_id like $2`, [tid[t], `cd_${t}_%`]))[0].n);
    ok(rows === expect[t] && evts === expect[t], `租户${t}：表行 ${rows} == 事件 ${evts} == 期望 ${expect[t]}（双写守恒）`);
    if (rows !== evts) { torn++; findings.push(`租户${t} 双写撕裂：表行 ${rows} ≠ 事件 ${evts}`); }
    // 无跨租户污染：本租户 deals 的 tenant_id 恒为自己
    const bad = Number((await q(`select count(*)::int n from deals where tenant_id=$1 and id like 'cd_%' and id not like $2`, [tid[t], `cd_${t}_%`]))[0].n);
    if (bad) { torn++; findings.push(`租户${t} 混入他租户 deals ${bad} 行`); }
  }
  ok(rejected === 0, `双写无拒绝/异常（rejected ${rejected}）`);
  ok(torn === 0, `双写无撕裂无污染（跨 3 租户 ×${per}）`);
  console.log(`    双写 ×${per * 3}｜耗时 ${Date.now() - start}ms`);
}

/* ============================================================
   ④ 席位配额竞争 + 邀请一次性
   ④a 同一邀请码 5 人并发抢 → 恰 1 成功（一次性不双花）
   ④b 席位配额是否防超卖（发码→兑现逻辑探针）
   ============================================================ */
console.log('\n— ④ 席位配额 + 邀请一次性 —');
{
  // 独立租户 D 做席位实验
  const bossD = 'd0000000-0000-4000-8000-00000000000d';
  const [{ id: tD }] = await q(`insert into tenants(name, created_by) values ('租户D',$1) returning id`, [bossD]);
  await q(`insert into subscriptions(tenant_id, seat_quota) values ($1, 3)`, [tD]);   // 配额=3（boss+2）
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [bossD, tD]);
  await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [tD, bossD]);

  // ④a 同码并发：boss 发 1 码，5 人抢（每人独立 uid，事务内注入 local uid → PGlite 事务串行，逐一原子）
  await setUid(bossD);
  const [{ code }] = await q(`select make_invite('sales') as code`);
  const roamers = Array.from({ length: 5 }, (_, i) => `d100000${i}-0000-4000-8000-00000000000${i}`);
  const joinResults = await Promise.all(roamers.map(u =>
    (async () => {
      try {
        return await db.transaction(async tx => {
          await tx.query(`select set_config('app.uid', $1, true)`, [u]);
          const r = await tx.query(`select join_tenant($1) as id`, [code]);
          return { u, ok: true, id: r.rows[0].id };
        });
      } catch (e) { return { u, ok: false, err: e.message }; }
    })()));
  const joinWins = joinResults.filter(r => r.ok);
  ok(joinWins.length === 1, `同一邀请码 5 人并发抢 → 恰 1 成功（一次性，实际 ${joinWins.length}）`,
    joinWins.length !== 1 ? '邀请码被双花' : '');
  if (joinWins.length > 1) findings.push(`邀请码在并发下被兑现 ${joinWins.length} 次（应仅 1 次）`);
  const usedCount = Number((await q(`select count(*)::int n from invites where code=$1 and used_by is not null`, [code]))[0].n);
  ok(usedCount === 1, `invites.used_by 恰置 1 次（实际 ${usedCount}）`);

  // ④b 超卖探针：配额=3（当前 boss+1 已入 = 2 席），再发 3 码给 3 新人全兑现 → 观测最终席位 vs 配额
  await setUid(bossD);
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const r = await q(`select make_invite('sales') as code`).then(x => x[0].code).catch(() => null);
    codes.push(r);   // make_invite 在 used(2)<quota(3) 时逐张放行——发码时不占席位
  }
  const issued = codes.filter(Boolean).length;
  const newcomers = Array.from({ length: 3 }, (_, i) => `d200000${i}-0000-4000-8000-00000000000${i}`);
  let redeemed = 0;
  for (let i = 0; i < 3; i++) {
    if (!codes[i]) continue;
    try {
      await db.transaction(async tx => {
        await tx.query(`select set_config('app.uid', $1, true)`, [newcomers[i]]);
        await tx.query(`select join_tenant($1) as id`, [codes[i]]);
      });
      redeemed++;
    } catch { /* 兑现失败计入统计 */ }
  }
  const [{ n: liveSeats }] = await q(`select count(*)::int n from seats where tenant_id=$1 and released_at is null`, [tD]);
  const [{ seat_quota: quota }] = await q(`select seat_quota from subscriptions where tenant_id=$1`, [tD]);
  console.log(`    ④b 探针：配额=${quota}｜发码成功=${issued}｜兑现成功=${redeemed}｜最终在用席位=${liveSeats}`);
  const oversold = liveSeats > quota;
  ok(!oversold, `席位不超卖（在用 ${liveSeats} ≤ 配额 ${quota}）`,
    oversold ? `超卖 ${liveSeats - quota} 席` : '');
  if (oversold) {
    findings.push(`【系统行为】席位可超卖：配额=${quota} 却兑现出 ${liveSeats} 席。根因——make_invite 仅在「发码时」以当前在用席位数校验配额（seats 不因发码增加），join_tenant 兑现侧完全不校验配额；因此「先批量发码、后兑现」可突破配额。复现：boss 连发 N 张 sales 码（每张发码时 used<quota 均放行），再由 N 名新人各自 join_tenant → 落 N 个 seats，不受 quota 约束。`);
  }
}

/* ============================================================
   ⑤ 同一 dedupKey 并发插卡 ×50 → 防疲劳应生效（不重复）
   ============================================================ */
console.log('\n— ⑤ 并发去重（同 dedupKey 插卡 ×50） —');
{
  const ctxA = ctxOf('a');
  const N = 50;
  const start = Date.now();
  const res = await Promise.all(Array.from({ length: N }, () =>
    insertCard(db, ctxA, { kind: 'talk', dedupKey: 'DEDUP_ONE', payload: { x: 1 } })
      .then(r => ({ ok: true, r })).catch(e => ({ ok: false, err: e.message }))));
  const created = res.filter(r => r.ok && r.r.cardId != null && r.r.skipped === undefined).length;
  const skipped = res.filter(r => r.ok && r.r.skipped === 'cooldown').length;
  const cards = Number((await q(`select count(*)::int n from action_cards where tenant_id=$1 and payload->>'dedupKey'=$2`, [tid.a, 'DEDUP_ONE']))[0].n);
  console.log(`    规模 ${N}｜落库卡数=${cards}｜返回created=${created}｜返回skipped=${skipped}｜耗时 ${Date.now() - start}ms`);
  const dedupHeld = cards === 1;
  ok(dedupHeld, `同 dedupKey 并发插卡去重生效：落库恰 1 张（实际 ${cards}）`,
    dedupHeld ? '' : `去重在并发下失效`);
  if (!dedupHeld) {
    findings.push(`【系统行为】cardBus 防疲劳去重在并发下失效（TOCTOU）：同 dedupKey 并发插卡 ×${N} 落库 ${cards} 张（应 1 张）。根因——insertCard 先 SELECT 查重、后事务 INSERT，check-then-act 之间无原子性保障，且 action_cards 无 dedupKey 唯一约束兜底；并发下多张卡的查重 SELECT 均在任何 INSERT 提交前返回空 → 全部放行。复现：Promise.all 并发调用 insertCard 同一 dedupKey。缓解：对 (tenant_id, payload->>'dedupKey') 建部分唯一索引或在事务内 SELECT ... FOR UPDATE 加锁。`);
  }
  // 串行对照：去重逻辑本身正确（证明缺陷在并发原子性而非逻辑）
  const s1 = await insertCard(db, ctxA, { kind: 'talk', dedupKey: 'DEDUP_SEQ', payload: {} });
  const s2 = await insertCard(db, ctxA, { kind: 'talk', dedupKey: 'DEDUP_SEQ', payload: {} });
  ok(s1.cardId != null && s2.skipped === 'cooldown', `串行对照：同 dedupKey 第二次 skipped（去重逻辑本身正确）`);
}

/* ============================================================
   ⑥ 交错读写：并发写 deals 同时并发跑 fold/m21 → 聚合自洽（无半写 NaN/负数）
   ============================================================ */
console.log('\n— ⑥ 交错读写：写 deals ∥ 读聚合（自洽性） —');
{
  // 🔴 用全新隔离租户 Z（不复用 a/b/c——它们已被 ②③ 写脏，会污染快照恒等式）
  const bossZ = 'e9000000-0000-4000-8000-00000000009e';
  const [{ id: tZ }] = await q(`insert into tenants(name, created_by) values ('租户Z',$1) returning id`, [bossZ]);
  await q(`insert into subscriptions(tenant_id) values ($1)`, [tZ]);
  await q(`insert into members(user_id, tenant_id, role) values ($1,$2,'boss')`, [bossZ, tZ]);
  await q(`insert into seats(tenant_id, user_id) values ($1,$2)`, [tZ, bossZ]);
  tid.z = tZ;
  const ctxC = { tenantId: tZ, actorId: bossZ, today: TEST_TODAY };
  const bossZfn = bossZ;
  await put(db, ctxC, 'categories', { id: 'catc', name: 'C品', gross_margin_rate: 0.5 }, 'category_created');
  await put(db, ctxC, 'salespersons', { id: 'spc1', name: 'S1', level: 'sales', is_active: true }, 'salesperson_created');
  await put(db, ctxC, 'salespersons', { id: 'spc2', name: 'S2', level: 'sales', is_active: true }, 'salesperson_created');
  await put(db, ctxC, 'lead_assignments', { id: 'lac1', employee_id: 'spc1', month: '2026-07', assigned_leads: 40, self_dev_leads: 5, source_type: 'ad' }, 'lead_assignment_created');
  await put(db, ctxC, 'lead_assignments', { id: 'lac2', employee_id: 'spc2', month: '2026-07', assigned_leads: 60, self_dev_leads: 0, source_type: 'ad' }, 'lead_assignment_created');

  const writers = [];
  let seq = 0;
  for (let i = 0; i < 60; i++) {
    const sp = i % 2 ? 'spc1' : 'spc2';
    writers.push(put(db, ctxC, 'deals', {
      id: `cdc_${seq++}`, employee_id: sp, deal_date: '2026-07-10', payment_amt: 2000, category_id: 'catc',
      status: 'won', paid_date: '2026-07-10', margin_rate_snapshot: 0.5,
    }, 'deal_created'));
  }
  // 交错读者：并发采样 fold（单次 event_stream 读 = 原子快照），断言「快照内自洽」。
  // 🔴 口径：不跨快照比 fold vs SQL（两次独立读在写入中途取，本就是不同时刻，差异不代表半写）；
  //   改测单个 fold 快照内部的不变量——每单 pay=2000/rate=0.5 ⇒ gm==pay/2、pay==dealCount×2000，
  //   且全程无 NaN/负数（半写状态会破坏这些恒等式）。
  const readers = [];
  const anomalies = [];
  for (let k = 0; k < 20; k++) {
    readers.push((async () => {
      const evs = await q(`select type, payload from event_stream where tenant_id=$1 order by event_id`, [tid.z]);
      const f = fold(evs);
      if (!Number.isFinite(f.totalPaymentAmt) || f.totalPaymentAmt < 0) anomalies.push(`pay=${f.totalPaymentAmt}`);
      if (!Number.isFinite(f.totalGrossMarginAmt) || f.totalGrossMarginAmt < 0) anomalies.push(`gm=${f.totalGrossMarginAmt}`);
      // 快照内恒等式（原子读，与写入进度无关）
      if (f.totalGrossMarginAmt !== Math.round(f.totalPaymentAmt * 0.5)) anomalies.push(`gm≠pay/2 (${f.totalGrossMarginAmt}/${f.totalPaymentAmt})`);
      if (f.totalPaymentAmt !== f.dealCount * 2000) anomalies.push(`pay≠cnt×2000 (${f.totalPaymentAmt}/${f.dealCount})`);
    })());
  }
  const start = Date.now();
  await Promise.all([...writers, ...readers]);
  // 收尾一致性
  const evs = await q(`select type, payload from event_stream where tenant_id=$1 order by event_id`, [tid.z]);
  const f = fold(evs);
  const sqlPay = Number((await q(`select coalesce(sum(payment_amt),0)::bigint v from deals where tenant_id=$1`, [tid.z]))[0].v);
  ok(anomalies.length === 0, `交错读写全程无半写异常（20 次快照内恒等式 gm==pay/2 ∧ pay==cnt×2000，无 NaN/负数）`, anomalies.slice(0, 3).join(';'));
  ok(f.totalPaymentAmt === sqlPay, `收尾一致：fold 回款 ${f.totalPaymentAmt} == SQL ${sqlPay}`);
  // 交错后跑 m21（读一致性收口）
  await setUid(bossZfn);
  const m21 = await runM21(db, ctxC, { month: '2026-07' });
  const nanRows = m21.rows.filter(r => (r.normMargin != null && !Number.isFinite(r.normMargin)) || (r.index != null && !Number.isFinite(r.index)));
  ok(m21.done && nanRows.length === 0, `m21 归一化自洽（${m21.n} 人，无 NaN），imbalanceRate=${m21.imbalanceRate}`);
  console.log(`    交错读写 60 写 ∥ 20 读｜耗时 ${Date.now() - start}ms`);
}

console.log(`\n══════ B 汇总 ══════`);
console.log(`  总耗时 ${Date.now() - t0}ms`);
if (findings.length) {
  console.log('\n🔴 发现（真实问题/系统行为）：');
  findings.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
}
await db.close();
console.log(`\n[B. 高并发+乐观锁+一致性] 断言 ${failures ? '✗ ' + failures + ' 失败' : '✅ 全通过'}｜发现 ${findings.length} 项`);
process.exit(failures ? 1 : 0);
