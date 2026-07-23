'use strict';
/* ============================================================================
   销售定薪器 · 发码/激活云函数（零依赖 · 纯 Node 内置模块）
   作用：① 订单自动发码  ② 客户自助换机/重激活（限次）  ③ 订单落文件 + 后台备份下载
   与「定薪器 / 发码器」靠同一个暗号 + 同一套 HMAC-SHA256 出码算法对接。
   启动：node server.js   （生产用 pm2，见 ecosystem.config.js / SETUP.md）
   ========================================================================== */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

/* ---------------- 配置（用环境变量覆盖，别把密钥写死提交）---------------- */
const CFG = {
  PORT: parseInt(process.env.PORT || '8787', 10),
  // 暗号：必须和定薪器 ACT_SECRETS 里「当前那个」以及发码器 DEF_SECRET 一致
  SECRET: process.env.DX_SECRET || '9c2f7e14ab5d380c6f1e9b4a2d7c5f80e3a1b6d94c8f2e70',
  // 后台口令（看订单 / 下备份 / 手动发码），务必改成你自己的
  ADMIN_PW: process.env.DX_ADMIN_PW || 'change-me-admin',
  // 签发口令（给你的支付平台 webhook 用，自动发码时带上），务必改成你自己的
  ISSUE_TOKEN: process.env.DX_ISSUE_TOKEN || 'change-me-issue-token',
  MAX_REISSUE: parseInt(process.env.DX_MAX_REISSUE || '3', 10), // 每单允许自助重激活次数
  DATA_DIR: process.env.DX_DATA_DIR || __dirname,
  // 可选：新订单/重激活推送到这个 URL（server酱/企业微信机器人等），留空则不推
  NOTIFY_URL: process.env.DX_NOTIFY_URL || ''
};
const ORDERS_FILE = path.join(CFG.DATA_DIR, 'orders.jsonl');

/* ---------------- 出码：与发码器/定薪器逐字节一致 ----------------
   通用码：DX-G-<hex(buyer)>-<hmac(secret,'G|'+buyer).slice(0,20)>
   锁机码：DX-D-<dev12>-<hmac(secret,'D|'+dev).slice(0,20)>
   Node 的 HMAC-SHA256 与定薪器里的纯 JS 实现输出相同（已端到端验证）。 */
function hmac20(secret, msg) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(msg, 'utf8')).digest('hex').slice(0, 20);
}
function hexOf(s) { return Buffer.from(s, 'utf8').toString('hex'); }
function makeCode(mode, payload) {
  if (mode === 'D') {
    if (!/^[0-9a-f]{12}$/.test(payload)) throw new Error('设备码需为 12 位十六进制');
    return 'DX-D-' + payload + '-' + hmac20(CFG.SECRET, 'D|' + payload);
  }
  const buyer = payload || ('auto-' + nowStamp());
  return 'DX-G-' + hexOf(buyer) + '-' + hmac20(CFG.SECRET, 'G|' + buyer);
}

/* ---------------- 订单存储：append-only jsonl + 启动重建索引 ---------------- */
let INDEX = Object.create(null); // orderId -> { orderId, code, mode, buyer, device, reissues, createdAt, events:[] }
function nowStamp() { return new Date().toISOString(); }
function appendEvent(ev) {
  fs.appendFileSync(ORDERS_FILE, JSON.stringify(ev) + '\n');
  applyEvent(ev);
}
function applyEvent(ev) {
  let o = INDEX[ev.orderId];
  if (!o) { o = INDEX[ev.orderId] = { orderId: ev.orderId, reissues: 0, events: [] }; }
  o.events.push({ t: ev.t, type: ev.type, code: ev.code, mode: ev.mode, device: ev.device });
  if (ev.type === 'issue') {
    o.code = ev.code; o.mode = ev.mode; o.buyer = ev.buyer || o.buyer; o.device = ev.device || o.device;
    if (!o.createdAt) o.createdAt = ev.t;
  }
  if (ev.type === 'reissue') { o.code = ev.code; o.mode = ev.mode; o.device = ev.device || o.device; o.reissues++; }
}
function loadOrders() {
  INDEX = Object.create(null);
  if (!fs.existsSync(ORDERS_FILE)) return;
  const lines = fs.readFileSync(ORDERS_FILE, 'utf8').split('\n');
  for (const ln of lines) { if (!ln.trim()) continue; try { applyEvent(JSON.parse(ln)); } catch (e) {} }
}

/* ---------------- 可选推送（新订单提醒你）---------------- */
function notify(text) {
  if (!CFG.NOTIFY_URL) return;
  try {
    const u = new URL(CFG.NOTIFY_URL);
    const body = JSON.stringify({ text: text, msgtype: 'text', content: text });
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.on('error', () => {}); req.write(body); req.end();
  } catch (e) {}
}

/* ---------------- HTTP 工具 ---------------- */
function send(res, code, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h); res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
  });
}
function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- 后台页面（口令保护）---------------- */
function adminHTML() {
  const rows = Object.values(INDEX).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map(o => `<tr><td>${esc(o.orderId)}</td><td>${esc(o.mode || '')}</td><td class="mono">${esc(o.code || '')}</td>`
      + `<td>${esc(o.buyer || '')}</td><td>${esc(o.device || '')}</td><td>${o.reissues}/${CFG.MAX_REISSUE}</td><td>${esc(o.createdAt || '')}</td></tr>`).join('');
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>发码后台</title><style>body{font-family:system-ui,"PingFang SC",sans-serif;background:#0F1416;color:#ECF1F0;margin:0;padding:20px}
h1{font-size:18px}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#5BB98C;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}th,td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left;vertical-align:top}
th{color:#93A0A2;font-size:11px;text-transform:uppercase}.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0}
a.btn,button{background:#5BB98C;color:#08130E;border:none;border-radius:9px;padding:9px 14px;font-weight:700;text-decoration:none;font-size:13px;cursor:pointer}
input,select{background:#212A2E;border:1px solid rgba(255,255,255,.12);color:#ECF1F0;border-radius:8px;padding:8px 10px;font-size:13px}
.card{background:#1A2124;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px;margin:12px 0}</style>
<h1>🔑 发码后台 · 共 ${Object.keys(INDEX).length} 单</h1>
<div class="bar"><a class="btn" href="/admin/orders.jsonl?pw=${encodeURIComponent(CFG.ADMIN_PW)}">⬇ 下载订单备份 orders.jsonl</a></div>
<div class="card"><b>手动发码</b>
<div class="bar">
<input id=oid placeholder="订单号"><select id=mode><option value=G>通用码</option><option value=D>锁机码</option></select>
<input id=extra placeholder="买家备注 / 设备码(锁机时填12位)">
<button onclick="issue()">生成并记账</button><span id=out class=mono></span></div></div>
<table><tr><th>订单号</th><th>类型</th><th>激活码</th><th>买家</th><th>设备</th><th>重激活</th><th>时间</th></tr>${rows}</table>
<script>
async function issue(){
  const r=await fetch('/api/issue',{method:'POST',headers:{'Content-Type':'application/json','x-issue-token':${JSON.stringify(CFG.ISSUE_TOKEN)}},
    body:JSON.stringify({orderId:oid.value.trim(),mode:mode.value,buyer:mode.value==='G'?extra.value.trim():'',device:mode.value==='D'?extra.value.trim():''})});
  const j=await r.json(); out.textContent=j.ok?j.code:('✗ '+j.error); if(j.ok)setTimeout(()=>location.reload(),900);
}
</script>`;
}

/* ---------------- 客户自助换机 / 重激活页 ---------------- */
function reactivateHTML() {
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>换机 / 重新激活</title><style>body{font-family:system-ui,"PingFang SC",sans-serif;background:#0F1416;color:#ECF1F0;margin:0;padding:24px;max-width:460px;margin:0 auto}
h1{font-size:20px}p{color:#93A0A2;font-size:13.5px;line-height:1.7}label{display:block;font-size:13px;font-weight:600;margin:14px 0 5px}
input{width:100%;background:#212A2E;border:1px solid rgba(255,255,255,.12);color:#ECF1F0;border-radius:11px;padding:12px;font-size:15px;box-sizing:border-box}
button{width:100%;background:#5BB98C;color:#08130E;border:none;border-radius:12px;padding:14px;font-weight:700;font-size:15px;margin-top:16px;cursor:pointer}
.out{margin-top:14px;font-family:ui-monospace,Menlo,monospace;font-size:14px;color:#5BB98C;word-break:break-all;text-align:center;min-height:20px}
.warn{background:rgba(224,107,107,.12);border:1px solid #E06B6B;color:#F0B4B4;border-radius:11px;padding:11px 13px;font-size:13px;margin:10px 0}</style>
<h1>换机 / 重新激活</h1>
<p>清了缓存或换了设备？在这里用<b>订单号</b>重新领取激活码。每单限 ${CFG.MAX_REISSUE} 次。</p>
<div class="warn">先在新设备打开定薪器，把激活页显示的 <b>12 位设备码</b> 抄下来填在下面。</div>
<label>订单号</label><input id=oid placeholder="你的订单号">
<label>新设备的 12 位设备码</label><input id=dev placeholder="例如 a1b2c3d4e5f6" autocapitalize=off spellcheck=false>
<button onclick="go()">重新领取激活码</button>
<div class="out" id=out></div>
<script>
async function go(){
  out.style.color='#93A0A2'; out.textContent='处理中…';
  const r=await fetch('/api/reactivate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({orderId:oid.value.trim(),device:dev.value.trim()})});
  const j=await r.json();
  if(j.ok){ out.style.color='#5BB98C'; out.textContent=j.code; }
  else { out.style.color='#E06B6B'; out.textContent='✗ '+j.error; }
}
</script>`;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;

  // 健康检查（pm2 / 探活）
  if (p === '/health' || p === '/api/health') return send(res, 200, { ok: true, orders: Object.keys(INDEX).length });

  // 客户重激活页
  if (p === '/' || p === '/reactivate') return send(res, 200, reactivateHTML(), { 'Content-Type': 'text/html; charset=utf-8' });

  // 后台页（口令）
  if (p === '/admin') {
    if (!timingSafeEq(u.query.pw || '', CFG.ADMIN_PW)) return send(res, 401, '需要口令：/admin?pw=你的口令', { 'Content-Type': 'text/plain; charset=utf-8' });
    return send(res, 200, adminHTML(), { 'Content-Type': 'text/html; charset=utf-8' });
  }
  // 备份下载（口令）
  if (p === '/admin/orders.jsonl') {
    if (!timingSafeEq(u.query.pw || '', CFG.ADMIN_PW)) return send(res, 401, 'need pw', { 'Content-Type': 'text/plain' });
    const data = fs.existsSync(ORDERS_FILE) ? fs.readFileSync(ORDERS_FILE, 'utf8') : '';
    return send(res, 200, data, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders-backup.jsonl"' });
  }

  // 签发（给支付 webhook 或后台用；带签发口令）
  if (p === '/api/issue' && req.method === 'POST') {
    const token = req.headers['x-issue-token'] || (await Promise.resolve());
    const body = await readBody(req);
    if (!timingSafeEq(req.headers['x-issue-token'] || body.token || '', CFG.ISSUE_TOKEN)) return send(res, 403, { ok: false, error: '签发口令不对' });
    const orderId = String(body.orderId || '').trim();
    if (!orderId) return send(res, 400, { ok: false, error: '缺订单号' });
    if (INDEX[orderId] && INDEX[orderId].code) return send(res, 200, { ok: true, code: INDEX[orderId].code, note: '该订单已发过码' });
    let code;
    try { code = makeCode(body.mode === 'D' ? 'D' : 'G', body.mode === 'D' ? String(body.device || '').trim() : String(body.buyer || '').trim()); }
    catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    appendEvent({ t: nowStamp(), type: 'issue', orderId, code, mode: body.mode === 'D' ? 'D' : 'G', buyer: body.buyer || '', device: body.device || '' });
    notify('🟢 新订单发码 ' + orderId + ' → ' + code);
    return send(res, 200, { ok: true, code });
  }

  // 自助重激活（客户用；无签发口令，靠订单号 + 次数上限约束）
  if (p === '/api/reactivate' && req.method === 'POST') {
    const body = await readBody(req);
    const orderId = String(body.orderId || '').trim();
    const device = String(body.device || '').trim();
    const o = INDEX[orderId];
    if (!o || !o.code) return send(res, 404, { ok: false, error: '查无此订单号（确认没输错）' });
    if (!/^[0-9a-f]{12}$/.test(device)) return send(res, 400, { ok: false, error: '设备码要 12 位（数字+a~f）' });
    if (o.reissues >= CFG.MAX_REISSUE) return send(res, 429, { ok: false, error: '本单重激活已达上限（' + CFG.MAX_REISSUE + ' 次），请联系卖家' });
    const code = makeCode('D', device);
    appendEvent({ t: nowStamp(), type: 'reissue', orderId, code, mode: 'D', device });
    notify('🔁 重激活 ' + orderId + '（第 ' + INDEX[orderId].reissues + ' 次）→ ' + code);
    return send(res, 200, { ok: true, code });
  }

  send(res, 404, { ok: false, error: 'not found' });
});

loadOrders();
server.listen(CFG.PORT, () => {
  console.log('[发码云函数] 已启动 http://127.0.0.1:' + CFG.PORT + ' · 现有订单 ' + Object.keys(INDEX).length + ' 单');
  if (CFG.ADMIN_PW === 'change-me-admin' || CFG.ISSUE_TOKEN === 'change-me-issue-token')
    console.log('⚠️  请务必用环境变量改掉默认口令 DX_ADMIN_PW / DX_ISSUE_TOKEN（见 SETUP.md）');
});
