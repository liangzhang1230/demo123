import type { SeedData } from '../../domain/types';
import TopBar from '../../components/TopBar';
import Board from '../../components/board/Board';

/** /boss 管理端决策看板 · 老板视图（五区全量＋底部固定条，看板章 §2） */
export default function BossPage({ data }: { data: SeedData }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <TopBar />
      <Board data={data} scope={{ role: 'boss' }} />
    </div>
  );
}
