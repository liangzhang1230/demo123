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
    spacing: { before: 320, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
    children: [new TextRun({ text, font: F, bold: true, size: 28, color: NAVY })],
  });
}
function body(runs, opts = {}) {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new Paragraph({
    spacing: { after: 100, line: 330 },
    ...opts,
    children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
  });
}
function bullet(runs) {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new Paragraph({
    numbering: { reference: 'dot', level: 0 },
    spacing: { after: 80, line: 330 },
    children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
  });
}
function box(runs) {
  const rs = (typeof runs === 'string') ? [{ text: runs }] : runs;
  return new Paragraph({
    spacing: { before: 60, after: 140, line: 330 },
    shading: { type: ShadingType.CLEAR, fill: LIGHT },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
    indent: { left: 240 },
    children: rs.map(r => new TextRun({ font: F, size: 21, color: '2B3138', ...r })),
  });
}

// 三列表：阶段计划
const PW = [1500, 3200, 4660];
function planTable() {
  const rows = [
    ['第 1 个月', '机制 + 启动', '重设销售提成与激励机制（对优秀销售有吸引力的版本）；招聘物料与渠道全面铺开；确定人才画像与筛选标准。'],
    ['第 2 个月', '快筛 + 到岗', '3-7 天快筛流程跑起来，10 人分批到岗；试用淘汰机制同步上线，不合适的人不过周，招聘成本不浪费。'],
    ['第 3 个月', 'SOP + 出单', '销售流程拆解到动作、量化到人；PK 与即时激励上线；人均开单进入爬坡轨道。'],
  ];
  return new Table({
    columnWidths: PW,
    width: { size: PW[0] + PW[1] + PW[2], type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [th('阶段', PW[0]), th('重点', PW[1]), th('主要动作', PW[2])],
      }),
      ...rows.map(([a, b, c]) => new TableRow({
        children: [
          td([{ text: a, bold: true, color: NAVY }], PW[0]),
          td([{ text: b, bold: true }], PW[1]),
          td(c, PW[2]),
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

// ===== 题头 =====
children.push(new Paragraph({
  spacing: { after: 80 },
  children: [new TextRun({ text: '10 人销售团队 · 90 天组建与操盘方案', font: F, size: 36, bold: true, color: NAVY })],
}));
children.push(new Paragraph({
  spacing: { after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E8E2D5', space: 4 } },
  children: [new TextRun({ text: '张良 · 销售业绩操盘手（20 年销售团队实战）    电话/微信：135 5272 5767', font: F, size: 20, color: GRAY })],
}));

// ===== 一、目标 =====
children.push(h1('一、目标'));
children.push(body([
  { text: '90 天，把 10 人销售团队' },
  { text: '招起来、筛出来、带到出单轨道', bold: true },
  { text: '。每月最后一个工作日，我交一页数据复盘（到岗、留存、人均开单、下月动作）——' },
  { text: '干得行不行，每个月都看得见。', bold: true },
]));

// ===== 二、90 天计划 =====
children.push(h1('二、90 天计划'));
children.push(planTable());
children.push(body([{ text: '说明：以上为节奏框架，具体指标（到岗节奏、留存率、人均开单基线）入职第一周内与公司共同定标，写入月度复盘。', color: GRAY }], { spacing: { before: 120, after: 100 } }));

// ===== 三、需要公司的配合 =====
children.push(h1('三、需要公司的配合'));
children.push(bullet([{ text: '授权：', bold: true }, { text: '销售条线的激励机制、招聘筛选、销售流程由我负责搭建与执行；重要事项每周例会向公司同步对齐。' }]));
children.push(bullet([{ text: '预算：', bold: true }, { text: '销售人员薪酬按既定标准执行（8,000 元/月 + 社保 + 提成），团队激励机制在该预算框架内设计，不额外增加固定成本。' }]));

// ===== 四、合作条款 =====
children.push(h1('四、合作条款'));

children.push(body([{ text: '1. 本人薪酬（与结果挂钩的阶梯方案）', bold: true, size: 22 }], { spacing: { before: 60, after: 60 } }));
children.push(box([
  { text: '第 1-2 个月：8,000 元/月。' },
]));
children.push(box([
  { text: '自第 3 个月起：12,000 元/月。生效条件（三项同时达成）：① 10 人到岗；② 当月团队留存达标；③ 人均开单达到共同定标的基线。' },
  { text: '任一项未达成，薪酬维持 8,000 元/月不变。', bold: true },
]));
children.push(body([{ text: '即：涨薪只在团队立起来之后发生，公司不为过程多付一分钱。', color: GRAY }], { spacing: { after: 140 } }));

children.push(body([{ text: '2. 发薪节奏（现行制度不变，增设借支通道）', bold: true, size: 22 }], { spacing: { before: 60, after: 60 } }));
children.push(box([
  { text: '发薪日不变：', bold: true },
  { text: '仍按公司现行制度，每月 25 日发放上月工资。' },
]));
children.push(box([
  { text: '增设借支通道：', bold: true },
  { text: '每月 10 日，员工可按借支预支上月应发工资的 50%，25 日发薪时直接抵扣，财务仅增加一张抵扣单，不改动任何现行制度。' },
]));
children.push(box([
  { text: '设立理由：', bold: true },
  { text: '本次要在短期内招聘 10 名销售，入职后近两个月才见首笔工资，会直接推高招聘难度与入职流失。借支通道是招聘吸引力的配套工具。新入职人员（含本人）首月可预支当月应发的 50%，次月抵扣——由本人首月先行试跑，把预支-抵扣流程在财务侧跑通，再向新员工开放。' },
]));

children.push(body([{ text: '3. 复盘与退出', bold: true, size: 22 }], { spacing: { before: 60, after: 60 } }));
children.push(box([
  { text: '每月一页数据复盘交公司。任一月度复盘公司认为不达预期，可随时终止合作，无附加条件。' },
]));

// ===== 结尾 =====
children.push(new Paragraph({
  spacing: { before: 280, after: 60 },
  alignment: AlignmentType.CENTER,
  children: [
    new TextRun({ text: '行不行，每个月都看得见。', font: F, bold: true, size: 26, color: NAVY }),
  ],
}));
children.push(new Paragraph({
  spacing: { after: 0 },
  alignment: AlignmentType.CENTER,
  children: [
    new TextRun({ text: '张良 · 135 5272 5767（电话/微信同号）', font: F, size: 20, color: GRAY }),
  ],
}));

const doc = new Document({
  styles: { default: { document: { run: { font: F, size: 21 } } } },
  numbering: {
    config: [
      { reference: 'dot', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertMillimetersToTwip(22), bottom: convertMillimetersToTwip(22),
          left: convertMillimetersToTwip(22), right: convertMillimetersToTwip(22),
        },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('销售团队组建方案-张良.docx', buf);
  console.log('written', buf.length);
});
