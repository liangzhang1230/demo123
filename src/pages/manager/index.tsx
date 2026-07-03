import { Link } from 'react-router-dom';
import type { SeedData } from '../../domain/types';

/** /manager 主管看板（同板裁剪本部门）—— P3 施工位 */
export default function ManagerPage({ data }: { data: SeedData }) {
  const dept = data.departments.find((d) => d.id === 'd1');
  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <Link to="/" className="text-sm text-gray-400">← 返回种子状态页</Link>
      <h1 className="mt-2 text-lg font-bold">主管看板（刘敏 · {dept?.name}）</h1>
      <p className="mt-4 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        P3 施工位：本部门裁剪视图（摘除购买位）
      </p>
    </div>
  );
}
