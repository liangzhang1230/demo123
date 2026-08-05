export const LOST = '流失';

export type Relation = '本人' | '家长' | '孩子' | '其他';

export interface Member {
  relation: Relation;
  name: string;
  phone?: string;
  wechat?: string;
  note?: string;
}

export interface FollowUp {
  id: string;
  at: string;
  type: 'note' | 'stage' | 'claim' | 'release' | 'recycle';
  text: string;
  from?: string;
  to?: string;
}

export interface Customer {
  id: string;
  name: string;
  members: Member[];
  stage: string;
  owner: 'me' | null;
  source: string;
  note: string;
  lostReason: string;
  createdAt: string;
  lastFollowUpAt: string;
  followUps: FollowUp[];
}

export interface Settings {
  stages: string[];
  recycleDays: number;
  noRecycleFrom: string;
}

export interface AppState {
  settings: Settings;
  customers: Customer[];
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
}

/** 私海、未流失、未到免回收阶段的客户，据此判断“快被回收”预警 */
export function recyclable(c: Customer, s: Settings): boolean {
  if (c.owner !== 'me' || c.stage === LOST) return false;
  const stop = s.stages.indexOf(s.noRecycleFrom);
  const idx = s.stages.indexOf(c.stage);
  return !(stop >= 0 && idx >= stop);
}
