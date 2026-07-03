/**
 * 数据层：内存 Store ＋ localStorage 持久（演示机本地），一键重置。
 * 加载时重跑守恒断言；跑不平即拒绝启动（抛错由 UI 兜底展示）。
 */
import type { SeedData } from '../domain/types';
import { generateSeed } from './generator';
import { SEED_VERSION } from './plan';
import { runSeedChecks } from './assertions';

const LS_KEY = 'sales-demo/seed';

function validateOrThrow(data: SeedData): SeedData {
  const { results } = runSeedChecks(data);
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    throw new Error(`种子校验失败 ${failed.length} 项：${failed.map((f) => f.name).join('；')}`);
  }
  return data;
}

export function loadSeed(): SeedData {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw) as SeedData;
        if (data.version === SEED_VERSION) return validateOrThrow(data);
      } catch {
        // 落库损坏或版本过期 → 重新生成
      }
    }
  }
  return resetSeed();
}

export function resetSeed(): SeedData {
  const data = validateOrThrow(generateSeed());
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }
  return data;
}

export function clearSeed(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY);
}
