/**
 * 体验版数据层：与 api.real.ts 同签名，但一切都在浏览器本地完成
 * （localStorage 持久，环境不允许时退化为内存）。仅在 DEMO=1 构建时启用。
 */
import type { AppState, Customer, Member, Settings } from './types';
import { LOST } from './types';

// App.tsx 的「重置示例数据」按钮也用这个 key，改名要同步
const DB_KEY = 'funnel_demo_db';

const DEFAULT_SETTINGS: Settings = {
  stages: ['线索', '已联系', '有意向', '试听/体验', '成交', '复购/转介绍'],
  recycleDays: 14,
  noRecycleFrom: '成交',
};

let memoryDb: AppState | null = null;

function readStorage(): AppState | null {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    return memoryDb;
  }
}

function writeStorage(db: AppState) {
  memoryDb = db;
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* 沙箱禁用 localStorage 时只留内存 */
  }
}

let uidCounter = 0;
const uid = () => `d${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
const now = () => new Date().toISOString();
const daysAgo = (n: number, hour = 10) =>
  new Date(Date.now() - n * 86400e3 - hour * 3600e3).toISOString();

interface SeedSpec {
  name: string;
  members: Member[];
  source: string;
  note?: string;
  owner: 'me' | null;
  /** [阶段, 几天前] 依次流转；LOST 结尾表示流失 */
  path: [string, number][];
  lostReason?: string;
  extraNotes?: [string, number][];
  releasedDaysAgo?: [number, string] | null;
}

function seedCustomer(s: SeedSpec): Customer {
  const followUps: Customer['followUps'] = [];
  let prev: string | undefined;
  let last = now();
  for (const [stage, ago] of s.path) {
    const at = daysAgo(ago);
    followUps.push({
      id: uid(), at, type: 'stage', from: prev, to: stage,
      text: prev === undefined
        ? `建档，进入「${stage}」`
        : stage === LOST
          ? `流失（原因：${s.lostReason || '未填'}）`
          : `「${prev}」→「${stage}」`,
    });
    prev = stage;
    last = at;
  }
  for (const [text, ago] of s.extraNotes ?? []) {
    const at = daysAgo(ago);
    followUps.push({ id: uid(), at, type: 'note', text });
    if (at > last) last = at;
  }
  if (s.releasedDaysAgo) {
    const [ago, reason] = s.releasedDaysAgo;
    followUps.push({
      id: uid(), at: daysAgo(ago), type: 'release',
      text: `放回公海（${reason}）`,
    });
  }
  followUps.sort((a, b) => a.at.localeCompare(b.at));
  const stage = s.path[s.path.length - 1][0];
  return {
    id: uid(),
    name: s.name,
    members: s.members,
    stage,
    owner: s.owner,
    source: s.source,
    note: s.note ?? '',
    lostReason: stage === LOST ? (s.lostReason ?? '') : '',
    createdAt: followUps[0].at,
    lastFollowUpAt: last,
    followUps,
  };
}

function seed(): AppState {
  const customers = [
    seedCustomer({
      name: '张小雨', source: '抖音', owner: 'me',
      members: [
        { relation: '孩子', name: '张小雨', phone: '13800001111', note: '8 岁，想学少儿编程' },
        { relation: '家长', name: '张先生', phone: '13900001111', wechat: 'zhang_dad' },
      ],
      path: [['线索', 9], ['已联系', 8], ['有意向', 6], ['试听/体验', 1]],
      extraNotes: [
        ['电话接通，家长很感兴趣，孩子在学校学过一点 Scratch', 8],
        ['约了本周六上午的体验课，家长孩子一起来', 1],
      ],
    }),
    seedCustomer({
      name: '李想', source: '地推', owner: 'me',
      members: [
        { relation: '孩子', name: '李想', note: '10 岁' },
        { relation: '家长', name: '李女士', phone: '13700002222' },
      ],
      path: [['线索', 20], ['已联系', 18], ['有意向', 12]],
      extraNotes: [['家长说考虑一下，等期中考完再定', 12]],
    }),
    seedCustomer({
      name: '王一诺', source: '美团', owner: null,
      members: [
        { relation: '孩子', name: '王一诺' },
        { relation: '家长', name: '王女士', phone: '13600003333' },
      ],
      path: [['线索', 25]],
      extraNotes: [['打了两次电话都没接', 22]],
      releasedDaysAgo: [21, '电话一直没人接，先放着'],
    }),
    seedCustomer({
      name: '陈成', source: '转介绍', owner: 'me',
      note: '成人就业班 · 前端方向',
      members: [{ relation: '本人', name: '陈成', phone: '13500004444', wechat: 'chencheng' }],
      path: [['线索', 40], ['已联系', 38], ['有意向', 35], ['试听/体验', 30], ['成交', 25]],
      extraNotes: [['试听满意，已缴全款，下月开班', 25]],
    }),
    seedCustomer({
      name: '周美琪', source: '老客户', owner: 'me',
      members: [
        { relation: '孩子', name: '周美琪', note: '12 岁，续第二期' },
        { relation: '家长', name: '周妈妈', phone: '13400005555', wechat: 'zhou_mm' },
      ],
      path: [['线索', 90], ['已联系', 88], ['有意向', 85], ['试听/体验', 82], ['成交', 78], ['复购/转介绍', 10]],
      extraNotes: [['第一期结课，家长主动续费第二期，还介绍了同班同学', 10]],
    }),
    seedCustomer({
      name: '刘星', source: '抖音', owner: 'me',
      members: [
        { relation: '孩子', name: '刘星' },
        { relation: '家长', name: '刘先生', phone: '13300006666' },
      ],
      path: [['线索', 30], ['已联系', 28], ['有意向', 26], [LOST, 24]],
      lostReason: '价格没谈拢',
    }),
    seedCustomer({
      name: '赵一帆', source: '朋友圈', owner: 'me',
      members: [{ relation: '孩子', name: '赵一帆' }],
      path: [['线索', 0]],
    }),
  ];
  return { settings: { ...DEFAULT_SETTINGS }, customers };
}

function loadDb(): AppState {
  const db = readStorage();
  if (db && Array.isArray(db.customers) && db.settings?.stages?.length) return db;
  const fresh = seed();
  writeStorage(fresh);
  return fresh;
}

function recycleOverdue(db: AppState): boolean {
  const { recycleDays, noRecycleFrom, stages } = db.settings;
  const stopIdx = stages.indexOf(noRecycleFrom);
  const deadline = Date.now() - recycleDays * 86400e3;
  let changed = false;
  for (const c of db.customers) {
    if (c.owner !== 'me' || c.stage === LOST) continue;
    const idx = stages.indexOf(c.stage);
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

function mutate<T>(fn: (db: AppState) => T): Promise<T> {
  const db = loadDb();
  const result = fn(db);
  writeStorage(db);
  return Promise.resolve(result);
}

function mustFind(db: AppState, id: string): Customer {
  const c = db.customers.find((x) => x.id === id);
  if (!c) throw new Error('客户不存在');
  return c;
}

// ---------- 与 api.real.ts 同签名的导出 ----------

export const getToken = () => 'demo';
export const setToken = (_t: string) => {};
export const clearToken = () => {};

export const login = (_password: string) => Promise.resolve({ token: 'demo' });

export const fetchState = (): Promise<AppState> =>
  mutate((db) => {
    recycleOverdue(db);
    return JSON.parse(JSON.stringify(db)) as AppState;
  });

export const saveSettings = (s: Settings): Promise<Settings> =>
  mutate((db) => {
    const clean = s.stages.map((x) => x.trim()).filter(Boolean);
    if (clean.length < 2) throw new Error('阶段列表至少要两个非空名称');
    if (new Set(clean).size !== clean.length || clean.includes(LOST)) {
      throw new Error(`阶段名不能重复，且「${LOST}」是内置侧出口不用列进来`);
    }
    if (!Number.isInteger(s.recycleDays) || s.recycleDays < 1 || s.recycleDays > 365) {
      throw new Error('回收天数要在 1–365 之间');
    }
    db.settings = {
      stages: clean,
      recycleDays: s.recycleDays,
      noRecycleFrom: clean.includes(s.noRecycleFrom) ? s.noRecycleFrom : clean[clean.length - 1],
    };
    return db.settings;
  });

export const createCustomer = (data: {
  name: string; source?: string; note?: string; members?: Member[];
}): Promise<Customer> =>
  mutate((db) => {
    if (!data.name.trim()) throw new Error('姓名必填');
    const at = now();
    const stage = db.settings.stages[0];
    const c: Customer = {
      id: uid(),
      name: data.name.trim(),
      members: data.members ?? [],
      stage,
      owner: 'me',
      source: (data.source ?? '').trim(),
      note: (data.note ?? '').trim(),
      lostReason: '',
      createdAt: at,
      lastFollowUpAt: at,
      followUps: [{ id: uid(), at, type: 'stage', to: stage, text: `建档，进入「${stage}」` }],
    };
    db.customers.push(c);
    return c;
  });

export const updateCustomer = (
  id: string,
  data: Partial<Pick<Customer, 'name' | 'source' | 'note' | 'members'>>,
): Promise<Customer> =>
  mutate((db) => {
    const c = mustFind(db, id);
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new Error('姓名不能为空');
      c.name = data.name.trim();
    }
    if (data.source !== undefined) c.source = data.source.trim();
    if (data.note !== undefined) c.note = data.note.trim();
    if (data.members !== undefined) c.members = data.members.filter((m) => m.name.trim());
    return c;
  });

export const deleteCustomer = (id: string): Promise<{ ok: boolean }> =>
  mutate((db) => {
    const i = db.customers.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('客户不存在');
    db.customers.splice(i, 1);
    return { ok: true };
  });

export const addFollowUp = (id: string, text: string): Promise<Customer> =>
  mutate((db) => {
    const c = mustFind(db, id);
    const at = now();
    c.followUps.push({ id: uid(), at, type: 'note', text: text.trim() });
    c.lastFollowUpAt = at;
    return c;
  });

export const setStage = (id: string, to: string, lostReason?: string): Promise<Customer> =>
  mutate((db) => {
    const c = mustFind(db, id);
    if (to !== LOST && !db.settings.stages.includes(to)) throw new Error('未知阶段');
    if (to === c.stage) return c;
    const at = now();
    const from = c.stage;
    c.stage = to;
    c.lostReason = to === LOST ? (lostReason ?? '').trim() : '';
    c.followUps.push({
      id: uid(), at, type: 'stage', from, to,
      text: to === LOST ? `流失（原因：${c.lostReason || '未填'}）` : `「${from}」→「${to}」`,
    });
    c.lastFollowUpAt = at;
    return c;
  });

export const claim = (id: string): Promise<Customer> =>
  mutate((db) => {
    const c = mustFind(db, id);
    const at = now();
    c.owner = 'me';
    c.lastFollowUpAt = at;
    c.followUps.push({ id: uid(), at, type: 'claim', text: '从公海认领' });
    return c;
  });

export const release = (id: string, reason?: string): Promise<Customer> =>
  mutate((db) => {
    const c = mustFind(db, id);
    c.owner = null;
    c.followUps.push({
      id: uid(), at: now(), type: 'release',
      text: `放回公海${reason?.trim() ? `（${reason.trim()}）` : ''}`,
    });
    return c;
  });
