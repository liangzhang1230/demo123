import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { SeedData } from '../../domain/types';
import { foldEvents } from '../../seed/fold';
import MorningTalk from '../../components/MorningTalk';
import WeaponDock from '../../components/WeaponDock';
import { HeartbeatCell6, MoneyTriageBar } from '../../components/LockableSlots';
import { useLitAll } from '../../components/useLitAll';

/**
 * /boss 管理端决策看板（一屏五区＋底部条）。
 * P6 已装配：晨话静态位（区一顶部）、心跳第 6 格锁位、钱事分诊条锁段、区五武器坞＋一键点亮。
 * 区一/区二其余五格/区四/底部条仍为 P3 施工位，P3 按看板章逐格真算后嵌装。
 */
export default function BossPage({ data }: { data: SeedData }) {
  const [lit, toggleLit] = useLitAll();
  // 数据就绪徽标的成交笔数由事件流实时折算（铁律 2：读侧事实，非硬编码）
  const dealCnt = useMemo(
    () =>
      foldEvents(data.events, data.people, data.categories, data.anchorDate, data.openDate)
        .totalDealCnt,
    [data],
  );

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:max-w-2xl">
      <Link to="/" className="text-sm text-gray-400">← 返回种子状态页</Link>
      <h1 className="mb-3 mt-2 text-lg font-bold">管理端决策看板（{data.tenant.bossName}）</h1>

      {/* AI 操盘手晨话（区一顶部静态位）＋早报样卡 */}
      <div className="mb-3">
        <MorningTalk />
      </div>

      {/* 区一 · 今日一件事 —— P3 施工位 */}
      <div className="mb-3 rounded-xl border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">
        区一 · 今日一件事（待办＞诊断固定序）—— P3 施工位
      </div>

      {/* 区二 · 经营心跳：前五格 P3 施工位，第 6 格锁位已装配（P6） */}
      <section className="mb-3 rounded-xl border border-gray-200 p-3">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">区二 · 经营心跳（六数）</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {['本月净利', '本月回款', '团队 labor_roi', '本月成交', '目标进度'].map((k) => (
            <div key={k} className="rounded-lg border border-dashed border-gray-200 p-2 text-center">
              <div className="text-xs text-gray-400">{k}</div>
              <div className="text-[11px] text-gray-300">P3 施工位</div>
            </div>
          ))}
          <HeartbeatCell6 lit={lit} />
        </div>
      </section>

      {/* 区三 · 钱事分诊条（锁段已装配，真算段随 P3） */}
      <section className="mb-3 rounded-xl border border-gray-200 p-3">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">区三 · 钱事分诊条</h2>
        <MoneyTriageBar lit={lit} />
      </section>

      {/* 区四 · 团队一屏 —— P3 施工位 */}
      <div className="mb-3 rounded-xl border border-dashed border-gray-300 p-4 text-center text-xs text-gray-400">
        区四 · 团队一屏（回本色·labor_roi·排名·停滞）—— P3 施工位
      </div>

      {/* 区五 · 武器坞（P6 完整装配） */}
      <WeaponDock dealCnt={dealCnt} lit={lit} onToggleLit={toggleLit} />

      {/* 底部固定条 —— P3 施工位 */}
      <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-3 text-center text-[11px] text-gray-400">
        底部条 · 筛人漏斗小块＋系统投入产出参照 —— P3 施工位
      </div>
    </div>
  );
}
