import express from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { load, getDb, save, uid, password, LOST } from './store.mjs';

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '2mb' }));

const now = () => new Date().toISOString();

// ---------- 认证 ----------
const MAX_TOKENS = 20;
let failedLogins = 0;

app.post('/api/login', async (req, res) => {
  // 暴力试探的朴素减速：每次失败全局加 300ms 延迟，上限 3s
  if (failedLogins > 0) {
    await new Promise((r) => setTimeout(r, Math.min(failedLogins * 300, 3000)));
  }
  if (typeof req.body?.password !== 'string' || req.body.password !== password()) {
    failedLogins += 1;
    return res.status(401).json({ error: '密码不对' });
  }
  failedLogins = 0;
  const db = getDb();
  const token = randomBytes(24).toString('hex');
  db.tokens.push({ token, at: now() });
  if (db.tokens.length > MAX_TOKENS) db.tokens.splice(0, db.tokens.length - MAX_TOKENS);
  await save();
  res.json({ token });
});

app.use('/api', (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !getDb().tokens.some((t) => t.token === token)) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
});

// ---------- 公海自动回收 ----------
function stageIndex(db, stage) {
  return db.settings.stages.indexOf(stage);
}

function recycleOverdue(db) {
  const { recycleDays, noRecycleFrom } = db.settings;
  const stopIdx = stageIndex(db, noRecycleFrom);
  const deadline = Date.now() - recycleDays * 86400e3;
  let changed = false;
  for (const c of db.customers) {
    if (c.owner !== 'me' || c.stage === LOST) continue;
    const idx = stageIndex(db, c.stage);
    if (stopIdx >= 0 && idx >= stopIdx) continue;
    if (new Date(c.lastFollowUpAt).getTime() > deadline) continue;
    c.owner = null;
    c.followUps.push({
      id: uid(), at: now(), type: 'recycle',
      text: `超过 ${recycleDays} 天未跟进，自动回收到公海`,
    });
    changed = true;
  }
  return changed;
}

// ---------- 数据 ----------
app.get('/api/state', async (req, res) => {
  const db = getDb();
  if (recycleOverdue(db)) await save();
  res.json({ settings: db.settings, customers: db.customers });
});

app.put('/api/settings', async (req, res) => {
  const db = getDb();
  const { stages, recycleDays, noRecycleFrom } = req.body ?? {};
  if (!Array.isArray(stages) || stages.length < 2 || stages.some((s) => typeof s !== 'string' || !s.trim())) {
    return res.status(400).json({ error: '阶段列表至少要两个非空名称' });
  }
  const clean = stages.map((s) => s.trim());
  if (new Set(clean).size !== clean.length || clean.includes(LOST)) {
    return res.status(400).json({ error: `阶段名不能重复，且「${LOST}」是内置侧出口不用列进来` });
  }
  if (!Number.isInteger(recycleDays) || recycleDays < 1 || recycleDays > 365) {
    return res.status(400).json({ error: '回收天数要在 1–365 之间' });
  }
  db.settings = {
    stages: clean,
    recycleDays,
    noRecycleFrom: clean.includes(noRecycleFrom) ? noRecycleFrom : clean[clean.length - 1],
  };
  await save();
  res.json(db.settings);
});

const RELATIONS = new Set(['本人', '家长', '孩子', '其他']);

function cleanMembers(members) {
  if (!Array.isArray(members)) return [];
  return members
    .filter((m) => m && typeof m.name === 'string' && m.name.trim())
    .map((m) => ({
      relation: RELATIONS.has(m.relation) ? m.relation : '其他',
      name: m.name.trim(),
      phone: String(m.phone ?? '').trim(),
      wechat: String(m.wechat ?? '').trim(),
      note: String(m.note ?? '').trim(),
    }));
}

app.post('/api/customers', async (req, res) => {
  const db = getDb();
  const { name, source, note, members } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '姓名必填' });
  }
  const at = now();
  const stage = db.settings.stages[0];
  const customer = {
    id: uid(),
    name: name.trim(),
    members: cleanMembers(members),
    stage,
    owner: 'me',
    source: String(source ?? '').trim(),
    note: String(note ?? '').trim(),
    lostReason: '',
    createdAt: at,
    lastFollowUpAt: at,
    followUps: [{ id: uid(), at, type: 'stage', to: stage, text: `建档，进入「${stage}」` }],
  };
  db.customers.push(customer);
  await save();
  res.json(customer);
});

function findCustomer(req, res) {
  const c = getDb().customers.find((x) => x.id === req.params.id);
  if (!c) res.status(404).json({ error: '客户不存在' });
  return c;
}

app.put('/api/customers/:id', async (req, res) => {
  const c = findCustomer(req, res);
  if (!c) return;
  const { name, source, note, members } = req.body ?? {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: '姓名不能为空' });
    c.name = name.trim();
  }
  if (source !== undefined) c.source = String(source).trim();
  if (note !== undefined) c.note = String(note).trim();
  if (members !== undefined) c.members = cleanMembers(members);
  await save();
  res.json(c);
});

app.delete('/api/customers/:id', async (req, res) => {
  const db = getDb();
  const i = db.customers.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '客户不存在' });
  db.customers.splice(i, 1);
  await save();
  res.json({ ok: true });
});

app.post('/api/customers/:id/followups', async (req, res) => {
  const c = findCustomer(req, res);
  if (!c) return;
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '跟进内容不能为空' });
  const at = now();
  c.followUps.push({ id: uid(), at, type: 'note', text });
  c.lastFollowUpAt = at;
  await save();
  res.json(c);
});

app.post('/api/customers/:id/stage', async (req, res) => {
  const db = getDb();
  const c = findCustomer(req, res);
  if (!c) return;
  const to = String(req.body?.to ?? '');
  if (to !== LOST && !db.settings.stages.includes(to)) {
    return res.status(400).json({ error: '未知阶段' });
  }
  if (to === c.stage) return res.json(c);
  const at = now();
  const from = c.stage;
  c.stage = to;
  c.lostReason = to === LOST ? String(req.body?.lostReason ?? '').trim() : '';
  c.followUps.push({
    id: uid(), at, type: 'stage', from, to,
    text: to === LOST
      ? `流失（原因：${c.lostReason || '未填'}）`
      : `「${from}」→「${to}」`,
  });
  c.lastFollowUpAt = at;
  await save();
  res.json(c);
});

app.post('/api/customers/:id/claim', async (req, res) => {
  const c = findCustomer(req, res);
  if (!c) return;
  const at = now();
  c.owner = 'me';
  // 认领即视为一次跟进，避免刚捞上来就被再次回收
  c.lastFollowUpAt = at;
  c.followUps.push({ id: uid(), at, type: 'claim', text: '从公海认领' });
  await save();
  res.json(c);
});

app.post('/api/customers/:id/release', async (req, res) => {
  const c = findCustomer(req, res);
  if (!c) return;
  const reason = String(req.body?.reason ?? '').trim();
  c.owner = null;
  c.followUps.push({
    id: uid(), at: now(), type: 'release',
    text: `放回公海${reason ? `（${reason}）` : ''}`,
  });
  await save();
  res.json(c);
});

// ---------- 静态托管（生产：先 npm run build） ----------
const dist = path.join(import.meta.dirname, '..', 'dist');
app.use(express.static(dist));
app.get('/', (req, res) => res.sendFile(path.join(dist, 'index.html')));

const firstRunPassword = await load();
app.listen(PORT, () => {
  console.log(`销售漏斗已启动: http://localhost:${PORT}`);
  if (process.env.FUNNEL_PASSWORD) {
    console.log('登录密码来自环境变量 FUNNEL_PASSWORD');
  } else if (firstRunPassword) {
    console.log(`首次运行已生成登录密码: ${firstRunPassword}`);
    console.log('（保存在 data/db.json 的 auth.password，可用环境变量 FUNNEL_PASSWORD 覆盖）');
  } else {
    console.log('登录密码沿用 data/db.json 里 auth.password（可用 FUNNEL_PASSWORD 覆盖）');
  }
});
