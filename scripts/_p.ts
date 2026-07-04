import { generateSeed } from '../src/seed/generator';
import { computeAll } from '../src/domain/compute';
const c = computeAll(generateSeed());
const agg: Record<string, Record<string, number>> = {};
for (const s of c.stallList) { agg[s.level] ??= {}; agg[s.level][s.stage] = (agg[s.level][s.stage] ?? 0) + 1; }
console.log(JSON.stringify(agg));
console.log('team roi', c.folded.teamLaborRoi?.toFixed(4));
console.log('wangli roi', c.folded.perOwnerRoi['wangli']?.toFixed(4));
