import type { SeedData } from '../../domain/types';
import TopBar from '../../components/TopBar';
import Board from '../../components/board/Board';

/** /manager 管理端决策看板 · 主管刘敏（华东一部）：同板裁剪本部门＋摘除武器坞购买位与投产参照（看板章 §2） */
export default function ManagerPage({ data }: { data: SeedData }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <TopBar />
      <Board data={data} scope={{ role: 'manager', deptId: 'd1', managerId: 'liumin' }} />
    </div>
  );
}
