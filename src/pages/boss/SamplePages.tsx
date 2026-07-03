/**
 * /sample/:key · 四包＋经营智库静态样例长页（P6）。
 * 铁律 2：本文件零计算——所有数字为写死的示例文案（素材按《第一件·3》人物故事线），
 * 右上角「示例数据」角标常驻；试看申请仅弹「上线后由商务开通」。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, ExampleBadge, GrayNote } from '../../components/ui';

interface Block {
  title: string;
  rows: { big?: string; text?: string; plain?: string; actions?: string[] }[];
}
interface SampleSpec {
  name: string;
  tagline: string;
  hook: string;
  blocks: Block[];
}

const SPECS: Record<string, SampleSpec> = {
  pack1: {
    name: '操盘包① · 人效操盘包',
    tagline: '这些人值不值、该招该汰该扩——同轴 labor_roi，招·用·汰·扩一条链',
    hook: '「李强第几天回本？正常吗？」「王五每月净烧多少？」',
    blocks: [
      {
        title: '每日置顶卡',
        rows: [{
          big: '【止血分诊 · 本月】2 个账号持续失血，合计每月净烧 ≈ ¥14,700（估算）',
          plain: '这几个人的工资每天照扣，业务已经停了。要不要关，你拍板，系统绝不自动动人。',
        }],
      },
      {
        title: '回本仪表盘 · 单人回本卡',
        rows: [
          {
            big: '李强 · 入职第 38 天 · 回本进度 62%',
            text: '预计回本日 ≈ 第 66 天（按本企业历史新人回本中位曲线外推 · 估算）；期间累计净亏 ¥4,100。',
            plain: '新人亏钱不等于招错了——对照你自己公司过去每个新人的爬坡曲线，他的节奏在正常带内。',
          },
          {
            big: '王丽 · ✓ 已回本 · labor_roi 2.10',
            plain: '每付 1 元工资赚回 2.1 元——她是这台机器上最贵也最值的零件。',
          },
        ],
      },
      {
        title: '止血分诊',
        rows: [{
          big: '① 王五 · 连续 47 天零业务事件 · 每月净烧 ≈ ¥8,900',
          text: '累计净亏 ¥9,200；月薪照付、业务归零——每月净烧 ¥8,900 在漏。',
          plain: '关停席位当天就停止成本计提（席位本周期仍占不退、数据完整保留）。',
          actions: ['止血：关停席位', '约谈观察', '汰评估'],
        }],
      },
      {
        title: '扩编算钱器',
        rows: [{
          big: '结论：② 先提效再扩张（估算 · 不定编）',
          text: '存量批次 labor_roi 1.71 稳定；近 90 天新增批次回本节奏比 92%（正常）；但样品→签约卡点未修——先修漏斗，别给漏损加杠杆。',
          plain: '想再加 1 人？按历史中位：约第 66 天回本，期间团队短期拖累约 ¥2.8 万（估算）。',
        }],
      },
      {
        title: '招聘投产比',
        rows: [{
          big: '本季筛选 2 人 → 留下 1 人 · 单个有效销售获取成本 ≈ ¥6,800',
          plain: '你的招聘机器每花 1 元，第 90 天回来 1.4 元（估算）——筛选准确度在同规模企业中位以上。',
        }],
      },
    ],
  },
  pack2: {
    name: '操盘包② · 增长操盘包',
    tagline: '下一笔钱在哪、现金什么时候回——杠杆链单一脊梁，找钱四步闭环',
    hook: '「样品池这个月为什么只出 9 单？卡着多少钱？」',
    blocks: [
      {
        title: '每日置顶卡 · 增长卡点',
        rows: [{
          big: '【唯一卡点】样品→签约：11.0%（上月 27.0%，掉了一半还多）',
          text: '本月 82 家进样品、只转出 9 家；按上月通过率本应多签 13 家 × 平均客单 ¥6,800 ＋ 后续复购——估算卡着 ¥49.6 万（估算）。',
          plain: '钱没丢，卡在样品池里。修这一跳，比多招两个人便宜得多。',
          actions: ['给赵敏派带教（出口至销冠 DNA）', '价格话术复盘'],
        }],
      },
      {
        title: '流失归因（并入卡点卡第二层）',
        rows: [{
          big: '首位流失因：「价格偏高」18 家 / 42.9%',
          plain: '与卡点交叉：价格异议集中爆发在样品之后——不是产品不行，是报价动作在漏。',
        }],
      },
      {
        title: '回款前瞻（CFO 级）',
        rows: [{
          big: '未来 30 天预计回款 ≈ ¥17.0 万（估算）',
          text: '按签约未回款池 42 家 × 本企业历史「签约→回款」节奏线性外推；强制排除超期 15 天以上管道。',
          plain: '下个月发工资的钱，今天就能看见轮廓。',
        }],
      },
      {
        title: '沉睡金矿（复购与转介绍）',
        rows: [{
          big: '超复购周期休眠 38 家 · 唤醒估值 ≈ ¥23.8 万（估算）',
          plain: '最便宜的钱是老客户口袋里的第二笔——派回清单只给销售「客户＋联系建议」，不暴露利润。',
          actions: ['一键派发唤醒清单'],
        }],
      },
    ],
  },
  pack3: {
    name: '操盘包③ · 销冠 DNA 克隆引擎',
    tagline: '她凭什么是销冠？她走了怎么办？——把销冠战法变成公司资产',
    hook: '「王丽凭什么？」「赵敏差哪一推？」',
    blocks: [
      {
        title: '销冠识别（复用排名 · 零新增阈值）',
        rows: [{
          big: '本季销冠：王丽 —— 回款全员第 1 · labor_roi 2.10',
          plain: '连续 3 个月霸榜，识别置信度：高。',
        }],
      },
      {
        title: '销冠 DNA 指纹（四维 · 全派生）',
        rows: [{
          text: '节奏：首触→样品 5.2 天（全员最快）｜ 结构：A 类客占比 31%（全员 18%）｜ 质量：样品→签约 38%（全员 14%）｜ 韧性：停滞客户回收率 64%。',
          plain: '她不是更努力，是每一跳都比别人少漏一点。',
        }],
      },
      {
        title: '赢点解码（最强的那一跳）',
        rows: [{
          big: '王丽的赢点＝样品→签约：38% vs 团队 14%',
          plain: '样品送出去 48 小时内必有一次带方案回访——这是可复制的动作，不是天赋。',
        }],
      },
      {
        title: '照镜子诊断（弱者首要带教点）',
        rows: [{
          big: '赵敏：线索全员第 2 · 样品→签约仅 9% ——「差一推的人」',
          text: '量 × 质二维定位：量强质弱象限；首要带教点＝样品跟进节奏（对标王丽赢点）。',
          plain: '她不缺客户，缺临门那一脚。带教一个月，比换人便宜十倍。',
          actions: ['一键设标杆：王丽 → 赵敏 · 目标环节 样品→签约'],
        }],
      },
      {
        title: '销冠依赖度雷达 ＋ 传承预案',
        rows: [{
          big: '王丽贡献本月回款 16% · 依赖度黄档',
          plain: '她走了怎么办？——把她的样品话术沉淀为标准动作，依赖度每降 1 档，公司值钱一分。',
        }],
      },
    ],
  },
  pack4: {
    name: '操盘包④ · 经营黑匣子',
    tagline: '我是怎么走到今天的、我的拍板值不值——决策→结果因果回放',
    hook: '「上月那次提价拍板，之后呢？」',
    blocks: [
      {
        title: '每月置顶卡',
        rows: [{ big: '【6 月航迹已生成】本月 1 条拍板留痕进入回放窗口', plain: '看板管当下，黑匣子管来时路。' }],
      },
      {
        title: '经营黑匣子（决策→结果回放）',
        rows: [{
          big: '5-18 拍板：「B 品类提价 5%」→ 之后 42 天：B 品类回款 −12% · 流失 +6 家',
          text: '「价格偏高」流失占比由 31% 升至 43%；同期 A/C 品类持平——变化集中在被提价的品类上。',
          plain: '那次拍板之后，B 品类在慢慢漏。要不要回调？数据在这儿，你拍板。',
          actions: ['发起复盘', '回调价格（走留痕）'],
        }],
      },
      {
        title: '增长航迹（月度里程碑）',
        rows: [{
          text: '4 月：系统开通 · 首月回款 ¥46.5 万 ｜ 5 月：复购客户破 20 家 ｜ 6 月：单月回款历史新高 ¥61.2 万。',
          plain: '每个月一枚钉子，钉出一条你自己的增长航迹。',
        }],
      },
      {
        title: '系统自证身价（动作台账）',
        rows: [{
          big: '90 天：系统提示 37 次 · 你拍板 21 次 · 平均响应 1.8 天',
          plain: '你和系统一起做过的每个决定都在账上——这套台账，换一家供应商就清零了。',
        }],
      },
      {
        title: '决策校准镜（判断 vs 事实 · 只提示不审判）',
        rows: [{
          text: '你的判断「提价不影响销量」 vs 事实「B 品类流失上升」——偏差 1 项，建议纳入本月复盘。',
          plain: '老板最贵的成本是重复犯同一个判断错误。',
        }],
      },
    ],
  },
  library: {
    name: '经营智库 · 定薪建议',
    tagline: '底薪该给多少、提成该怎么设——用数据答，不用感觉答',
    hook: '「李强的底薪给高了还是给低了？」',
    blocks: [
      {
        title: '销售底薪建议（第一板块）',
        rows: [{
          big: '同城快消经销 · 同岗位底薪带：¥4,800 – ¥6,500',
          text: '你当前销售底薪中位 ¥5,650，处于建议带内偏中位；新人建议带 ¥5,200 – ¥5,800。',
          plain: '底薪给在带内，靠提成拉开差距——底薪买的是出勤，提成买的是结果。',
        }],
      },
      {
        title: '销售提成建议（第二板块）',
        rows: [{
          text: '建议回款提成阶梯：月回款 ≤¥5 万 → 3%；¥5–8 万 → 4%；>¥8 万 → 5%（超额部分适用）。',
          plain: '阶梯要「够得着、值得跳」——第一档保底气，第三档留野心。',
        }],
      },
    ],
  },
};

export default function SamplePage() {
  const { key } = useParams();
  const spec = key ? SPECS[key] : undefined;
  const [toast, setToast] = useState<string | null>(null);

  if (!spec) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Link to="/boss" className="text-sm text-blue-600">← 返回决策看板</Link>
        <p className="mt-4 text-sm text-gray-500">样例页不存在</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-100 pb-24">
      <header className="sticky top-0 z-20 border-b border-amber-200 bg-amber-50 px-4 py-3">
        <div className="mx-auto flex max-w-md items-center justify-between lg:max-w-4xl">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-gray-900">{spec.name}</h1>
              <ExampleBadge inline />
            </div>
            <p className="text-[11px] text-gray-500">{spec.tagline}</p>
          </div>
          <Link to="/boss" className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200">
            ← 看板
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-3 px-3 pt-3 lg:max-w-4xl">
        <div className="rounded-xl bg-gray-900 px-4 py-3 text-xs text-gray-200">
          演示钩子：{spec.hook}
          <div className="mt-1 text-[10px] text-gray-400">
            本页为静态精修样例（示例数据）——正式开通后，以下每个数字由你的真实事件流每天自动生成。
          </div>
        </div>

        {spec.blocks.map((b, i) => (
          <Card key={i} className="relative">
            <ExampleBadge />
            <h2 className="mb-2 pr-16 text-sm font-bold text-gray-800">{b.title}</h2>
            <div className="space-y-3">
              {b.rows.map((r, j) => (
                <div key={j} className="rounded-xl bg-gray-50 p-3">
                  {r.big && <div className="text-sm font-bold leading-5 text-gray-900">{r.big}</div>}
                  {r.text && <div className="mt-1 text-xs leading-5 text-gray-600">{r.text}</div>}
                  {r.plain && <div className="mt-1.5 border-l-2 border-amber-300 pl-2 text-xs italic leading-5 text-gray-500">「{r.plain}」</div>}
                  {r.actions && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.actions.map((a) => (
                        <button
                          key={a}
                          onClick={() => setToast('演示样例：正式版此处走「建议→老板一键→留痕」链路')}
                          className="rounded-lg bg-white px-2 py-1 text-[11px] text-gray-700 ring-1 ring-gray-300"
                        >
                          [{a}]
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}

        <Card className="text-center">
          <p className="text-sm font-semibold text-gray-800">这一页，上线后每天用你的真实数据自动生成</p>
          <button
            onClick={() => setToast('试看申请已记录——上线后由商务开通')}
            className="mt-3 rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white"
          >
            试看申请
          </button>
          <div className="mt-2"><GrayNote>数据就绪：该演示租户已沉淀 214 笔成交 / 90 天数据——开通即出结论。</GrayNote></div>
        </Card>
      </main>

      {toast && (
        <div
          className="fixed inset-x-0 bottom-10 z-50 mx-auto w-fit cursor-pointer rounded-full bg-gray-900 px-4 py-2 text-xs text-white shadow-lg"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
