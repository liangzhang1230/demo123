import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const DATA_DIR = process.env.FUNNEL_DATA_DIR
  || path.join(import.meta.dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const LOST = '流失';

export const DEFAULT_SETTINGS = {
  stages: ['线索', '已联系', '有意向', '试听/体验', '成交', '复购/转介绍'],
  recycleDays: 14,
  // 从该阶段起（含之后的阶段）不再自动回收公海
  noRecycleFrom: '成交',
};

let db = null;
// 写盘串行化：mutation 都是内存改完再排队落盘，单进程内不会交叉写坏文件
let writeQueue = Promise.resolve();

export async function load() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch {
    db = { settings: { ...DEFAULT_SETTINGS }, customers: [], tokens: [], auth: {} };
  }
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  db.customers ??= [];
  db.tokens ??= [];
  db.auth ??= {};
  let firstRunPassword = null;
  if (!process.env.FUNNEL_PASSWORD && !db.auth.password) {
    db.auth.password = randomBytes(4).toString('hex');
    firstRunPassword = db.auth.password;
  }
  await save();
  return firstRunPassword;
}

export function getDb() {
  if (!db) throw new Error('store not loaded');
  return db;
}

export function password() {
  return process.env.FUNNEL_PASSWORD || db.auth.password;
}

export function save() {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, DB_FILE);
  });
  return writeQueue;
}

export const uid = () => randomUUID().replaceAll('-', '').slice(0, 12);
