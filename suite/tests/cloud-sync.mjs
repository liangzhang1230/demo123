#!/usr/bin/env node
/* 云同步端到端：本地伪 Supabase（GoTrue+PostgREST 语义）+ 真浏览器走完整流程
   登录 → 建租户(首版推送) → 改数据自动推送 → 第二设备拉取 → 版本冲突弹窗 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const pwCandidates = ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'];
let chromium = null;
for (const c of pwCandidates) { try { ({ chromium } = await import(c)); break; } catch (e) {} }
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, name, extra = '') => { if (cond) console.log(`  ✓ ${name}`); else { failures++; console.log(`  ✗ ${name} ${extra}`); } };

/* ---------- 伪后端（与 saas/schema.sql RPC 同语义） ---------- */
const users = {}, tenants = {}, members = {}, states = {}, invites = {};
let uidSeq = 0;
const srv = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(obj)); };
    const j = body ? JSON.parse(body) : {};
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    const uid = auth.startsWith('tok_') ? auth.slice(4) : null;
    const url = req.url;
    if (url.startsWith('/auth/v1/signup')) {
      const id = 'u' + (++uidSeq);
      users[j.email] = { id, password: j.password };
      return send(200, { id, email: j.email });
    }
    if (url.startsWith('/auth/v1/token')) {
      const u = users[j.email];
      if (!u || u.password !== j.password) return send(400, { error_description: 'Invalid login credentials' });
      return send(200, { access_token: 'tok_' + u.id, refresh_token: 'ref_' + u.id, user: { id: u.id, email: j.email } });
    }
    if (!uid) return send(401, { message: 'JWT required' });
    const my = members[uid];
    if (url.startsWith('/rest/v1/rpc/whoami'))
      return send(200, my ? [{ user_id: uid, tenant_id: my.tenant_id, tenant_name: tenants[my.tenant_id].name, role: my.role }] : []);
    if (url.startsWith('/rest/v1/rpc/create_tenant')) {
      if (my) return send(400, { message: 'already in a tenant' });
      const tid = 't' + uid;
      tenants[tid] = { name: j.tenant_name };
      members[uid] = { tenant_id: tid, role: 'boss' };
      states[tid] = { doc: {}, version: 1 };
      return send(200, tid);
    }
    if (url.startsWith('/rest/v1/rpc/make_invite')) {
      if (!my || my.role !== 'boss') return send(400, { message: 'boss only' });
      const code = 'INV' + Math.random().toString(36).slice(2, 8).toUpperCase();
      invites[code] = { tenant_id: my.tenant_id, role: j.invite_role || 'sales', used: false };
      return send(200, code);
    }
    if (url.startsWith('/rest/v1/rpc/join_tenant')) {
      const inv = invites[(j.invite_code || '').trim()];
      if (!inv || inv.used) return send(400, { message: 'invalid or expired invite' });
      if (my) return send(400, { message: 'already in a tenant' });
      inv.used = true;
      members[uid] = { tenant_id: inv.tenant_id, role: inv.role };
      return send(200, inv.tenant_id);
    }
    if (url.startsWith('/rest/v1/rpc/pull_state')) {
      if (!my) return send(200, []);
      const s = states[my.tenant_id];
      return send(200, [{ doc: s.doc, version: s.version, updated_at: new Date().toISOString() }]);
    }
    if (url.startsWith('/rest/v1/rpc/push_state')) {
      if (!my) return send(400, { message: 'not a member' });
      const s = states[my.tenant_id];
      if (s.version !== j.expected_version) return send(400, { message: 'version conflict' });
      s.doc = j.new_doc; s.version += 1;
      return send(200, s.version);
    }
    send(404, { message: 'not found ' + url });
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
console.log('▶ 伪 Supabase 端口', PORT);

const browser = await chromium.launch();
async function device() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + join(root, 'dist', 'index.html'));
  await page.waitForTimeout(500);
  page._errs = errs;
  return page;
}
const cfg = async (page) => {
  await page.evaluate(() => { location.hash = '#/cloud'; });
  await page.waitForTimeout(150);
  await page.fill('#cl-url', `http://127.0.0.1:${PORT}`);
  await page.fill('#cl-key', 'anon-test');
  await page.click('[data-act="cloud.save-cfg"]');
  await page.waitForTimeout(150);
};
const login = async (page, email, doSignup) => {
  await page.fill('#cl-email', email);
  await page.fill('#cl-pass', 'pass123');
  if (doSignup) { await page.click('[data-act="cloud.signup"]'); await page.waitForTimeout(200); }
  await page.click('[data-act="cloud.login"]');
  await page.waitForTimeout(400);
};

console.log('— 老板设备 —');
const boss = await device();
await cfg(boss);
await login(boss, 'boss@x.com', true);
ok(await boss.evaluate(() => document.getElementById('cl-tname') != null), '登录成功 → 进入建租户界面');
await boss.evaluate(() => { SK.DB.company.name = '云同步测试公司'; SK.persist(); });
await boss.fill('#cl-tname', '云同步测试公司');
await boss.click('[data-act="cloud.create-tenant"]');
await boss.waitForTimeout(500);
const st1 = Object.values(states)[0];
ok(st1 && st1.version === 2 && st1.doc.company && st1.doc.company.name === '云同步测试公司', '建租户 → 本地数据作为首版推送（版本 2）');

await boss.evaluate(() => { SK.DB.company.targetYearGrossWan = 2222; UI.commit(); });
await boss.waitForTimeout(3600);            // 3 秒去抖自动推送
ok(st1.version === 3 && st1.doc.company.targetYearGrossWan === 2222, `改目标 → 自动推送（版本 ${st1.version}）`);

console.log('— 邀请 + 销售设备 —');
await boss.click('[data-act="cloud.invite"][data-role="sales"]');
await boss.waitForTimeout(300);
const code = await boss.evaluate(() => document.querySelector('#modal-root .hero').textContent.trim());
ok(/^INV/.test(code), `邀请码生成 ${code}`);
await boss.click('[data-act="ui.modal-close"]');

const sales = await device();
await cfg(sales);
await login(sales, 'sales@x.com', true);
await sales.fill('#cl-code', code);
await sales.click('[data-act="cloud.join-tenant"]');
await sales.waitForTimeout(500);
const pulled = await sales.evaluate(() => ({ name: SK.DB.company.name, goal: SK.DB.company.targetYearGrossWan }));
ok(pulled.name === '云同步测试公司' && pulled.goal === 2222, '销售凭码加入 → 云端数据拉到本机（公司名/目标一致）');
const salesRole = await sales.evaluate(() => JSON.parse(localStorage.getItem('skab_suite_cloud')).role);
ok(salesRole === 'sales', '角色 = sales');

console.log('— 双端并发冲突 —');
await sales.evaluate(() => { SK.DB.company.attritionRate = 0.5; UI.commit(); });
await sales.waitForTimeout(3600);
ok(st1.version === 4, `销售端改动自动推送（版本 ${st1.version}）`);
// 老板端本地版本仍是 3 → 推送应冲突弹窗
await boss.evaluate(() => { SK.DB.company.hiringCycleDays = 99; SK.persist(); });
await boss.click('[data-act="cloud.push"]');
await boss.waitForTimeout(500);
ok(await boss.evaluate(() => document.querySelector('#modal-root').classList.contains('open') && document.querySelector('#modal-root').textContent.includes('云端有更新')), '过期版本推送 → 冲突弹窗（不静默覆盖）');
await boss.click('[data-act="cloud.conflict-pull"]');
await boss.waitForTimeout(500);
const merged = await boss.evaluate(() => SK.DB.company.attritionRate);
ok(merged === 0.5, '选择拉取云端 → 老板端拿到销售端的改动');

const bossErrs = await boss.evaluate(() => []);
ok(boss._errs.length === 0 && sales._errs.length === 0, '两台设备全程零页面错误', JSON.stringify([boss._errs, sales._errs]).slice(0, 200));

await browser.close(); srv.close();
console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 云同步端到端全部通过');
process.exit(failures ? 1 : 0);
