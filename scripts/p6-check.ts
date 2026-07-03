/**
 * P6 验收断言（npm run p6-check）：
 *  A1 早报样卡 ≤150 字（施工包 §3）
 *  A2 样例素材与样例长页零计算——packContent / PackSamplePage / LockableSlots / MorningTalk
 *     禁止 import 事件流折算器（seed/fold）与种子存储（seed/store）
 *  A3 四包样例长页齐备：id 唯一、人物钩子、≥3 个章节、价值主张非空
 *  A4 锁卡三要素齐备：试看申请文案「上线后由商务开通」、数据就绪徽标模板、在漏段价值语照抄原文
 *  A5 「示例数据」角标常驻：样例页与点亮样例值均引用 SampleBadge/SampleTag
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MORNING_REPORT_SAMPLE, PACKS } from '../src/components/packContent';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` ${detail}` : ''}`);
  if (!ok) failed++;
};

// A1
check('A1 早报样卡 ≤150 字', MORNING_REPORT_SAMPLE.length <= 150, `（${MORNING_REPORT_SAMPLE.length} 字）`);

// A2
const staticFiles = [
  'src/components/packContent.ts',
  'src/pages/boss/PackSamplePage.tsx',
  'src/components/LockableSlots.tsx',
  'src/components/MorningTalk.tsx',
];
for (const f of staticFiles) {
  const src = read(f);
  check(`A2 零计算 ${f}`, !/seed\/fold|seed\/store|foldEvents/.test(src));
}

// A3
check('A3 四包各一页', PACKS.length === 4, `（${PACKS.length} 包）`);
check('A3 包 id 唯一', new Set(PACKS.map((p) => p.id)).size === PACKS.length);
for (const p of PACKS) {
  check(
    `A3 ${p.seq} ${p.name} 素材齐备`,
    p.valueProp.length > 0 && p.hook.question.length > 0 && p.sections.length >= 3,
    `（${p.sections.length} 节）`,
  );
}

// A4
const dock = read('src/components/WeaponDock.tsx');
check('A4 试看申请仅弹「上线后由商务开通」', dock.includes('上线后由商务开通'));
check('A4 数据就绪徽标（成交笔数实时折算传入）', dock.includes('已沉淀 ${dealCnt} 笔成交 / 90 天数据'));
check('A4 一键点亮全家桶开关在位', dock.includes('一键点亮全家桶') && dock.includes('一键回锁'));
const slots = read('src/components/LockableSlots.tsx');
check('A4 在漏段价值语照抄原文', slots.includes('开通人效操盘包，这里每天告诉你在漏多少钱'));
check('A4 第 6 格锁态显 —＋钥匙', slots.includes('🔑'));

// A5
check('A5 样例页常驻角标', read('src/pages/boss/PackSamplePage.tsx').includes('<SampleBadge />'));
check('A5 点亮样例值带示例角标', slots.includes('<SampleTag />') && dock.includes('<SampleTag />'));
const talk = read('src/components/MorningTalk.tsx');
check('A5 早报样卡带示例角标', talk.includes('<SampleTag />'));
check('A5 晨话标注「上线后由 AI 销售操盘手…每日生成」', read('src/components/packContent.ts').includes('上线后由 AI 销售操盘手按你的真实数据每日生成'));

if (failed > 0) {
  console.error(`\nP6 验收失败：${failed} 项未过`);
  process.exit(1);
}
console.log('\nP6 验收断言全绿');
