import { useCallback, useState } from 'react';

/**
 * P6 「一键点亮全家桶」开关 —— 仅演示版存在的机能（正式版无此物）。
 * 点亮/回锁瞬时切换，localStorage 持久；「一键重置演示数据」不清此键（货架状态与种子互不相干）。
 */
const KEY = 'demo.litAll.v1';

export function useLitAll(): [boolean, () => void] {
  const [lit, setLit] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    setLit((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        /* 离线演示允许无痕模式：仅内存态 */
      }
      return next;
    });
  }, []);
  return [lit, toggle];
}
