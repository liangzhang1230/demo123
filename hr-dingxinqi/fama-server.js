#!/usr/bin/env node
/* ============================================================
   发码接口服务(零依赖,Node ≥14)
   职责只有三个:录订单 / 凭手机号+设备码自助领码补码 / 管理后台
   —— 不做在线激活校验(激活验证永远在用户本机离线完成)
   启动: node fama-server.js   守护: pm2 start fama-server.js --name fama
   ============================================================ */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ============ 配置(上线前必改前两项) ============ */
const CONFIG = {
  PORT: 8787,
  ADMIN_TOKEN: 'ADMIN-hrdx-7f3a9c-CHANGE-ME',        // 管理口令,务必改成自己的长随机串
  PRODUCTS: {                                          // 每个产品一把密钥,必须与对应 HTML 内 ACT_SECRET 一致
    hrdx: { name: '销售定薪器HR版', secret: 'HRDX-2026-a7f3e9c1b5d24f8a6e0c9b3d1f5a7c2e-K9' },
    // filter: { name: '公司筛选器', secret: '筛选器的ACT_SECRET' },   // 以后接入筛选器时解开
  },
  DATA_FILE: path.join(__dirname, 'data', 'orders.json'),
};

/* ============ 存储(JSON 文件,原子写) ============ */
let DB = { orders: [] };
function load() {
  try { DB = JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8')); }
  catch (e) { DB = { orders: [] }; }
  if (!Array.isArray(DB.orders)) DB.orders = [];
}
function save() {
  const dir = path.dirname(CONFIG.DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG.DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
  fs.renameSync(tmp, CONFIG.DATA_FILE);
}

/* ============ 发码算法(与 HTML 端 HMAC 验签严格一致) ============ */
const normHex = s => String(s || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const hmacHex = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');
const makeDCode = (secret, deviceCode) => 'XZ-D-' + hmacHex(secret, 'D|' + normHex(deviceCode)).slice(0, 20);
const makeGCode = (secret) => {
  const nonce = crypto.randomBytes(4).toString('hex');
  return 'XZ-G-' + nonce + '-' + hmacHex(secret, 'G|' + nonce).slice(0, 16);
};

/* ============ 业务 ============ */
const normPhone = s => String(s || '').replace(/\D/g, '');
function claim(phone, product, deviceCode) {
  phone = normPhone(phone);
  const fp = normHex(deviceCode);
  if (!phone || phone.length < 5) return { ok: false, error: '手机号不对' };
  if (!CONFIG.PRODUCTS[product]) return { ok: false, error: '未知产品' };
  if (fp.length < 8) return { ok: false, error: '设备码不对，请从激活页复制' };
  const mine = DB.orders.filter(o => o.phone === phone && o.product === product);
  if (!mine.length) return { ok: false, error: '没查到该手机号的订单，请联系卖家登记' };
  // 该设备已领过 → 幂等返回同一个码(补码免费,不占新名额)
  for (const o of mine) if (o.devices.some(d => d.fp === fp))
    return { ok: true, code: makeDCode(CONFIG.PRODUCTS[product].secret, fp), note: '该设备此前已领,原码找回' };
  // 找有空位的订单
  const slot = mine.find(o => o.devices.length < o.max);
  if (!slot) return { ok: false, error: '已达设备上限(' + mine.reduce((s, o) => s + o.max, 0) + '台)。换设备/清缓存后需补码请联系卖家重置' };
  slot.devices.push({ fp, at: new Date().toISOString() });
  save();
  return { ok: true, code: makeDCode(CONFIG.PRODUCTS[product].secret, fp) };
}

/* ============ HTTP ============ */
function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
const authed = q => q && q.token === CONFIG.ADMIN_TOKEN;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (u.pathname === '/api/health') return json(res, 200, { ok: true, orders: DB.orders.length });

  if (u.pathname === '/api/claim' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, claim(b.phone, b.product, b.deviceCode));
  }
  if (u.pathname === '/api/admin/order' && req.method === 'POST') {
    const b = await readBody(req);
    if (!authed(b)) return json(res, 403, { ok: false, error: 'token 错误' });
    const phone = normPhone(b.phone);
    if (!phone || !CONFIG.PRODUCTS[b.product]) return json(res, 200, { ok: false, error: '手机号或产品不对' });
    const order = { id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      phone, product: b.product, max: Math.max(1, Math.min(10, parseInt(b.maxDevices) || 1)),
      note: String(b.note || '').slice(0, 100), devices: [], createdAt: new Date().toISOString() };
    DB.orders.push(order); save();
    return json(res, 200, { ok: true, order });
  }
  if (u.pathname === '/api/admin/orders' && req.method === 'GET') {
    if (!authed({ token: u.searchParams.get('token') })) return json(res, 403, { ok: false, error: 'token 错误' });
    return json(res, 200, { ok: true, orders: DB.orders });
  }
  if (u.pathname === '/api/admin/reset' && req.method === 'POST') {
    const b = await readBody(req);
    if (!authed(b)) return json(res, 403, { ok: false, error: 'token 错误' });
    const o = DB.orders.find(x => x.id === b.id);
    if (!o) return json(res, 200, { ok: false, error: '订单不存在' });
    o.devices = []; save();
    return json(res, 200, { ok: true });
  }
  if (u.pathname === '/api/admin/gcode' && req.method === 'POST') {
    const b = await readBody(req);
    if (!authed(b)) return json(res, 403, { ok: false, error: 'token 错误' });
    if (!CONFIG.PRODUCTS[b.product]) return json(res, 200, { ok: false, error: '未知产品' });
    return json(res, 200, { ok: true, code: makeGCode(CONFIG.PRODUCTS[b.product].secret), warn: 'G码任意设备可激活,只用于测试/赠送,严禁售卖' });
  }
  if (u.pathname === '/' || u.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ADMIN_HTML);
  }
  json(res, 404, { ok: false, error: 'not found' });
});

/* ============ 管理后台(单页,口令在浏览器里输入) ============ */
const ADMIN_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>发码后台</title>
<style>body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:720px;margin:0 auto;padding:16px;background:#f5f5f2;color:#1a1c22}
.card{background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:16px;margin:12px 0}
input,select{font:inherit;padding:8px 10px;border:1px solid #d8d8d2;border-radius:8px;margin:4px 6px 4px 0}
button{font:inherit;font-weight:700;padding:8px 16px;border:none;border-radius:8px;background:#4f46e5;color:#fff;cursor:pointer;margin:4px 4px 4px 0}
table{width:100%;border-collapse:collapse;font-size:12.5px}td,th{padding:6px;border-bottom:1px dashed #e5e5e0;text-align:left}
.mono{font-family:ui-monospace,Menlo,monospace}.ok{color:#137333;font-weight:700}.err{color:#c5221f;font-weight:700}</style></head><body>
<h2>发码后台</h2>
<div class="card">管理口令 <input id="tk" type="password" placeholder="ADMIN_TOKEN"> <button onclick="loadOrders()">进入 / 刷新</button> <span id="m1"></span></div>
<div class="card"><b>录入订单</b>(你微信收款后在这里登记一条,买家即可自助领码)<br>
手机号 <input id="ph" placeholder="13800000000" style="width:140px">
产品 <select id="pd"><option value="hrdx">销售定薪器HR版</option></select>
台数 <select id="mx"><option>1</option><option>3</option></select>
备注 <input id="nt" placeholder="选填" style="width:110px">
<button onclick="addOrder()">登记</button> <span id="m2"></span></div>
<div class="card"><b>订单列表</b>(重置=清空该订单已绑设备,用于买家换机/清缓存后补码)<div id="list">先输入口令并刷新</div></div>
<div class="card"><b>G 型通用码</b>(任意设备可激活——只用于测试/赠送,严禁售卖)
<button onclick="gcode()">生成一个</button> <span id="m3" class="mono"></span></div>
<script>
const T=()=>document.getElementById('tk').value.trim();
const api=(p,body)=>fetch(p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}).then(r=>r.json());
async function loadOrders(){const d=await api('/api/admin/orders?token='+encodeURIComponent(T()));
  const el=document.getElementById('list');
  if(!d.ok){el.innerHTML='<span class="err">'+(d.error||'失败')+'</span>';return;}
  if(!d.orders.length){el.textContent='暂无订单';return;}
  el.innerHTML='<table><tr><th>时间</th><th>手机号</th><th>产品</th><th>已绑/上限</th><th>备注</th><th></th></tr>'+
   d.orders.slice().reverse().map(o=>'<tr><td>'+o.createdAt.slice(0,10)+'</td><td>'+o.phone+'</td><td>'+o.product+'</td><td>'+o.devices.length+'/'+o.max+'</td><td>'+(o.note||'')+'</td><td><button style="background:#c5221f;padding:4px 10px" onclick="resetO(\\''+o.id+'\\')">重置</button></td></tr>').join('')+'</table>';
  document.getElementById('m1').innerHTML='<span class="ok">✓ 共 '+d.orders.length+' 单</span>';}
async function addOrder(){const d=await api('/api/admin/order',{token:T(),phone:document.getElementById('ph').value,product:document.getElementById('pd').value,maxDevices:document.getElementById('mx').value,note:document.getElementById('nt').value});
  document.getElementById('m2').innerHTML=d.ok?'<span class="ok">✓ 已登记</span>':'<span class="err">'+(d.error||'失败')+'</span>';if(d.ok)loadOrders();}
async function resetO(id){if(!confirm('清空该订单已绑设备?'))return;const d=await api('/api/admin/reset',{token:T(),id});if(d.ok)loadOrders();else alert(d.error||'失败');}
async function gcode(){const d=await api('/api/admin/gcode',{token:T(),product:document.getElementById('pd').value});
  document.getElementById('m3').textContent=d.ok?d.code:(d.error||'失败');}
</script></body></html>`;

load();
server.listen(CONFIG.PORT, () => {
  console.log('[fama] 发码服务已启动 : http://0.0.0.0:' + CONFIG.PORT);
  console.log('[fama] 管理后台      : http://服务器IP:' + CONFIG.PORT + '/admin');
  console.log('[fama] 数据文件      : ' + CONFIG.DATA_FILE + ' (每周下载备份一次)');
});
