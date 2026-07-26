const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, convertMillimetersToTwip,
} = require('docx');
const fs = require('fs');

const NAVY = '1B2B3D';
const GOLD = 'B08D45';
const GRAY = '5A6472';
const LIGHT = 'F6F4EF';

const F = '微软雅黑';

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
    children: [new TextRun({ text, font: F, bold: true, size: 30, color: NAVY })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({ text, font: F, bold: true, size: 24, color: NAVY })],
  });
}
function body(runs, opts = {}) {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new Paragraph({
    spacing: { after: 100, line: 320 },
    ...opts,
    children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
  });
}
// 话术块：浅底、金色左边框
function script(lines, label) {
  const paras = [];
  if (label) {
    paras.push(new Paragraph({
      spacing: { before: 60, after: 20 },
      shading: { type: ShadingType.CLEAR, fill: LIGHT },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
      indent: { left: 240 },
      children: [new TextRun({ text: label, font: F, bold: true, size: 19, color: GOLD })],
    }));
  }
  lines.forEach((ln, i) => {
    const rs = (typeof ln === 'string') ? [{ text: ln }] : ln;
    paras.push(new Paragraph({
      spacing: { after: i === lines.length - 1 ? 140 : 40, line: 330 },
      shading: { type: ShadingType.CLEAR, fill: LIGHT },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
      indent: { left: 240 },
      children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
    }));
  });
  return paras;
}
function bullet(runs, ref = 'dot') {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80, line: 320 },
    children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
  });
}
function numbered(runs, ref) {
  return bullet(runs, ref);
}

const CW = [2600, 6760]; // 两列表格
function qaTable(rows) {
  return new Table({
    columnWidths: CW,
    width: { size: CW[0] + CW[1], type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          th('他说', CW[0]), th('你答', CW[1]),
        ],
      }),
      ...rows.map(([q, a]) => new TableRow({
        children: [
          td([{ text: q, bold: true, color: NAVY }], CW[0]),
          td(a, CW[1]),
        ],
      })),
    ],
  });
}
function th(text, w) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: NAVY },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: F, bold: true, size: 20, color: 'FFFFFF' })] })],
  });
}
function td(runs, w) {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      spacing: { line: 300 },
      children: rs.map(r => new TextRun({ font: F, size: 20, color: '2B3138', ...r })),
    })],
  });
}

const children = [];

// ===== 封面题头 =====
children.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: '内部谈判卡 · 仅自己看 · 勿外发', font: F, size: 18, color: GOLD, bold: true })],
}));
children.push(new Paragraph({
  spacing: { after: 80 },
  children: [new TextRun({ text: '谈判卡：10 人销售团队项目', font: F, size: 40, bold: true, color: NAVY })],
}));
children.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: '两个目标：个人薪资 8 千 → 1.2 万起；发薪节奏加装"10 号借支通道"。', font: F, size: 22, color: GRAY })],
}));
children.push(new Paragraph({
  spacing: { after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E8E2D5', space: 4 } },
  children: [new TextRun({ text: '总原则：两件事打包成一份条款一次谈。分开谈，每件都像讨价还价；打包谈，是一份专业条款。', font: F, size: 22, bold: true, color: NAVY })],
}));

// ===== 一、开局 =====
children.push(h1('一、开局：先立身份，再谈条款'));
children.push(body([{ text: '谈判开始前先把身份定住：你不是来应聘 8 千月薪岗位的候选人，你是来接手一个项目的操盘手——把 10 个人招起来、筛出来、带出单。所有条款都从这个身份里长出来。' }]));
children.push(body([{ text: '进门先讲活，再讲钱。', bold: true }, { text: '带着 90 天计划谈价，价才站得住（计划要点见附录）。' }]));
children.push(...script([
  '李总，我先说我怎么干，再说条件。',
  '90 天，三步：第一个月，把提成和激励机制改成销冠非来不可的样子，同步把招聘打出去；第二个月，用 3-7 天快筛把 10 个人筛到岗；第三个月，销售 SOP 拆到动作、上 PK，人均开单爬坡。',
  '干这个活，我有三个条件：一、薪资；二、销售条线给我授权；三、发薪日不动，加一个借支通道——第三条同时也是咱招 10 个销售必须配的入职工具。',
], '开场白（完整版，背下来）'));

// ===== 二、涨薪 =====
children.push(h1('二、涨薪：8 千 → 1.2 万起'));
children.push(h2('核心：不谈"我值多少"，谈"他在买什么"'));
children.push(bullet([{ text: '算他的账：', bold: true }, { text: '10 个人月工资加社保约 10 万，全从你手里过。他计较的那 4 千，是这 10 万盘子的保险费。' }]));
children.push(bullet([{ text: '用定薪器出对标：', bold: true }, { text: '本地"销售团队负责人/操盘手"行价 1.5 万起。数据说他给低了，你只负责打折——报价自带折扣理由，他有"占了便宜"的感觉而不是"被要挟"。' }]));
children.push(...script([
  [{ text: '李总，咱们先对齐我干的活：不是带队打卡，是 90 天把 10 个人招起来、筛出来、带出单。这 10 个人一个月工资加社保小 10 万，都从我手里过——我的工资差的那几千，赌的是这 10 万花得值不值。' }],
  [{ text: '市场上干这个活的行价 1 万 5 往上（对标表您过目），我按 1 万 2 来，因为我看好这个盘子。' }],
], '涨薪话术 · 第一轮（直接报价）'));
children.push(h2('杀手锏：阶梯涨薪（他犹豫时主动给台阶）'));
children.push(...script([
  [{ text: '您要是觉得一步到位有顾虑，也行：' }, { text: '前两个月还按 8 千发我，第三个月起 1 万 2', bold: true }, { text: '——条件写死：10 人到岗、留存达标、人均开单达标。达不到，您一分不用多发。写进 offer 就行。' }],
], '涨薪话术 · 第二轮（阶梯方案）'));
children.push(body([{ text: '为什么他难拒绝：', bold: true }, { text: '三个条件全是你手里能控的（招、筛、带是本行）；对他是"不涨白不涨，涨了说明赚了"——让不涨薪显得不划算，这就是"他主动接受"的机制。注意：这不是拿业绩额硬对赌，是拿团队建设里程碑说话。' }]));

// ===== 三、预支 =====
children.push(h1('三、预支：不改制度，加一张借支单'));
children.push(h2('结构（10 号版）'));
children.push(...script([
  [{ text: '发薪日 25 号一分不动。加一条：' }, { text: '每月 10 号按借支预支「上月应发」的一半，25 号照制度发剩余', bold: true }, { text: '——10 号拿的都是上个月已经干完的活钱，公司零风险，财务就多一张抵扣单。' }],
], '预支话术 · 常规月份'));
children.push(bullet([{ text: '为什么这个说法硬：', bold: true }, { text: '预支的是已挣到、只是还没到发薪日的钱——"提前拿自己已经干完的活钱"，道理上没人反驳得动。' }]));
children.push(bullet([{ text: '为什么是 10 号：', bold: true }, { text: '月初到账正好覆盖房贷、学费等月初固定划扣（这句只在心里，不用对他说）。' }]));
children.push(h2('包装成招聘工具（你的需求藏在团队方案里）'));
children.push(...script([
  [{ text: '这事不光是我：咱要招 10 个销售，销售兜里普遍紧，让人干 50 多天才见第一笔钱，一半人熬不到第一个发薪日就走了，招聘成本翻倍浪费。给新人开预支通道，是招聘工具，不是福利——我做团队机制，发薪节奏本来就是吸引力设计的一部分。' }],
], '预支话术 · 团队理由'));
children.push(h2('首月预支：三层理由，由公到私，逐层亮'));
children.push(body([{ text: '首月是全案最难的一句——只有首月是"活没干完先拿钱"。三层理由备好，第一层不够再亮第二层，能在上一层解决就绝不动下一层。', bold: true }]));
children.push(...script([
  [{ text: '借支流程立起来后，我第一个走——10 个人入职之前，得有人把"预支-抵扣"这一套在财务那儿跑通一遍，别等新人来了流程卡壳。就从我首月开始试：10 号预支当月一半，次月发薪抵扣。' }],
], '第一层 · 试跑流程（主理由，九成情况到这就够）'));
children.push(...script([
  [{ text: '说句实在的：行价一万五的活我按一万二接了，钱上我让了步；节奏上公司让我一步——预支带抵扣，公司一分风险没有。' }],
], '第二层 · 对等让步（他追问"为什么非要预支"时）'));
children.push(...script([
  [{ text: '我的固定支出都在月初划扣，所以发薪节奏这条是我合作的标准条款，在哪儿都一样。' }],
], '第三层 · 标准条款（他往私人原因上问时，一句带过）'));
children.push(body([{ text: '第三层说完就停。', bold: true }, { text: '不补充、不叹气、不说"你也知道现在压力大"。解释越多越像求人，一句陈述句最有力——"标准条款"四个字的意思是：有身价的人才有标准条款。' }]));

// ===== 四、应对分支 =====
children.push(h1('四、应对分支：他说 X，你答 Y'));
children.push(qaTable([
  ['1 万 2 太高了，预算就是 8 千', '不接价格拉锯，直接上阶梯方案："前两个月照旧 8 千，第三个月起 1 万 2，三个条件写死，达不到您一分不用多发。"'],
  ['提成、涨薪以后干好了再说', '"都不是大事，写一行就行——里程碑写进 offer，对咱俩都省心。"口头的"以后"等于没有，写下来的才是条款。'],
  ['预支？公司没这个先例', '第一层理由：试跑流程。"正因为没先例，10 个人入职前更得有人先把流程跑通，就从我开始试。"'],
  ['你为什么非要预支', '第二层理由：对等让步。"钱上我让了步，节奏上公司让我一步——带抵扣，公司零风险。"'],
  ['（继续往私人原因上问）', '第三层理由：标准条款。"我的固定支出都在月初划扣，这是我合作的标准条款，在哪儿都一样。"说完就停。'],
  ['发薪制度好几年了，不好改', '"制度我一个字不动，25 号照发。借支是财务常规动作，多一张抵扣单而已——不是改制度。"'],
  ['我只是股东，做不了主', '"这事不用拍板改制度，财务加个借支流程就行。您把方案递给管账的，需要的话我 5 分钟跟他说清。"——他说做不了主，就把事做成不需要做主的大小。'],
  ['先干着，条件以后慢慢谈', '"活我随时能开工。条件先落一页纸——就三行，五分钟的事。"入职后再谈 = 永远不谈，这条不让。'],
  ['（三条全拒，没有商量余地）', '不当场翻脸，说"我回去理一下，明天给您答复"。回去启动试金石判断（见第六节），其他投递与 B 线继续。'],
]));

// ===== 五、纪律 =====
children.push(h1('五、七条纪律（说错一句，前面全白搭）'));
children.push(numbered([{ text: '不说"我等钱花 / 手头紧 / 家里困难"', bold: true }, { text: '——需求要藏在机制里，不能挂在脸上。' }], 'num5'));
children.push(numbered([{ text: '不说"您看着给"', bold: true }, { text: '——报价必须是具体数字加理由。' }], 'num5'));
children.push(numbered([{ text: '报完价闭嘴', bold: true }, { text: '——谁先补充解释，谁先让步。沉默是谈判的一部分。' }], 'num5'));
children.push(numbered([{ text: '不先亮退让阶梯', bold: true }, { text: '——阶梯方案、首月 8 千预支这些牌，他不推你不出。' }], 'num5'));
children.push(numbered([{ text: '不接受口头承诺替代书面', bold: true }, { text: '——涨薪里程碑、借支通道，都要落在 offer 或一页纸上。' }], 'num5'));
children.push(numbered([{ text: '不当场答应降条件', bold: true }, { text: '——他压价时说"我回去想想"，第二天再回。当场松口的条件，他还会再压第二次。' }], 'num5'));
children.push(numbered([{ text: '不提年龄，不提过去的失败，不提"这几个月不容易"', bold: true }, { text: '——谈判桌上只有操盘手，没有求职者。' }], 'num5'));

// ===== 六、底线与试金石 =====
children.push(h1('六、底线与试金石'));
children.push(bullet([{ text: '退让阶梯（涨薪）：', bold: true }, { text: '1.2 万当月生效 → 阶梯（8 千两个月，第三个月起 1.2 万，里程碑写进 offer）→ 最低线：8 千接受，但阶梯条款必须书面。' }]));
children.push(bullet([{ text: '退让阶梯（预支）：', bold: true }, { text: '每月 10 号预支上月应发的一半 → 首月一次性预支 8 千、之后正常 → 最低线：首月必须有预支。' }]));
children.push(bullet([{ text: '试金石：', bold: true }, { text: '连"借支半个月已经干完的活钱"都不肯的公司，两个月后的发薪要打问号。你的跑道撑不起一次欠薪——这条谈不下来不是失去条件，是得到情报。' }]));
children.push(bullet([{ text: '谈判期间，B 线（提成成交岗）和其他家的投递一天都不停。', bold: true }, { text: '手里有别的选项，桌上的腰杆才是直的——这本身就是最大的谈判筹码。' }]));

// ===== 附录 =====
children.push(h1('附录：90 天计划要点（谈判时带着，一页纸即可）'));
children.push(numbered([{ text: '第 1 个月 · 机制 + 启动：', bold: true }, { text: '重设提成与激励（销冠非来不可的版本）；招聘物料与渠道铺开；定人才画像。' }], 'num6'));
children.push(numbered([{ text: '第 2 个月 · 到岗：', bold: true }, { text: '3-7 天快筛跑起来，10 人分批到岗；淘汰机制同步上线，庸才不过周。' }], 'num6'));
children.push(numbered([{ text: '第 3 个月 · 出单：', bold: true }, { text: '销售 SOP 拆到动作、量化到人；游戏化 PK 与即时激励上线；人均开单爬坡，月度数据复盘给老板。' }], 'num6'));
children.push(body([{ text: '每月给老板一页数据复盘——这既是"行不行每个月都看得见"的兑现，也是你 90 天后实名新案例的证据。', bold: true, color: GOLD }], { spacing: { before: 120, after: 200 } }));

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: F, size: 21 } },
    },
  },
  numbering: {
    config: [
      { reference: 'dot', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] },
      { reference: 'num5', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
      { reference: 'num6', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertMillimetersToTwip(20), bottom: convertMillimetersToTwip(20),
          left: convertMillimetersToTwip(20), right: convertMillimetersToTwip(20),
        },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('谈判卡-10人销售团队项目.docx', buf);
  console.log('written', buf.length);
});
