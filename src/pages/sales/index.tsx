import { Link } from 'react-router-dom';
import { useApp } from '../../store/AppStore';

/** /sales 销售端看板 —— P4 施工位 */
export default function SalesPage() {
  const { data } = useApp();
  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <Link to="/" className="text-sm text-gray-400">← 切换身份</Link>
      <h1 className="mt-2 text-lg font-bold">销售端看板（王丽）</h1>
      <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">📣 {data.bounty}</div>
      <p className="mt-4 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
        P4 施工位：今日待办 / 我的目标 / 我的排名 / 我的漏斗
      </p>
    </div>
  );
}
