import { Link } from 'react-router-dom';
import type { SeedData } from '../../domain/types';

/** /boss 管理端决策看板 —— P3 施工位 */
export default function BossPage({ data }: { data: SeedData }) {
  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <Link to="/" className="text-sm text-gray-400">← 返回种子状态页</Link>
      <h1 className="mt-2 text-lg font-bold">管理端决策看板（{data.tenant.bossName}）</h1>
      <p className="mt-4 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        P3 施工位：今日一件事 / 心跳六数 / 钱事分诊 / 团队一屏 / 武器坞
      </p>
    </div>
  );
}
