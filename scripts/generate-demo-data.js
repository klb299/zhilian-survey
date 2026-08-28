/**
 * 演示数据生成器
 * ------------------------------------------------------------
 * 用途：为管理后台生成与「项目既有调研成果」口径一致的演示问卷数据，
 *       便于演示、汇报与界面走查。生成的数据带 demo: true 标记，
 *       可随时一键清除，不会与真实提交混淆。
 *
 * 用法：
 *   node scripts/generate-demo-data.js           生成（默认 686 条，简短口语风）
 *   node scripts/generate-demo-data.js --verbose 生成完整书面风（句式较长，适合汇报）
 *   node scripts/generate-demo-data.js --seed 42 指定随机种子
 *   node scripts/generate-demo-data.js --total 200 指定条数（对齐比例仍按百分比换算）
 *   node scripts/generate-demo-data.js --append  在现有数据后追加（默认覆盖）
 *   node scripts/generate-demo-data.js --clear   仅清除演示数据，保留真实提交
 *
 * ============ 想改数据？按需求找下面这些位置 ============
 *   改生成条数     → 命令行 --total，或本文件 TOTAL_DEFAULT
 *   改时间范围     → TIME_START / TIME_END
 *   改随机种子     → 命令行 --seed
 *   改四类单位占比 → genUnitType() 里的权重表
 *   改各题选项占比 → genCourses / genEquipment / genProblems / genFeatures / genFee / genPilot
 *                    每个函数顶部都是一张 [[选项, 权重], ...] 表，数值即相对概率
 *   改对齐目标     → TARGET 常量（百分比 → 人数，改百分比即可）
 *   改文字内容     → SUGGESTIONS_BRIEF / SUGGESTIONS_FULL（建议）
 *                    PRIORITY_COURSE_BRIEF / _FULL、PRIORITY_JOB_BRIEF / _FULL（优先课程）
 *                    PRIORITY_PREFIX_*、PRIORITY_SUFFIX_*（前后缀）
 *   改文字长短     → TEXT_STYLE 里的句数、前缀、结尾句号概率
 *   改领域关键词   → server.js 里的 TOPICS 数组（影响后台词云统计）
 * 改完重新执行本脚本即可，服务无需重启（每次请求都重新读数据文件）。
 *
 * 对齐口径（对应 admin.html「项目既有调研成果」中的四个百分比）：
 *   91.4% 教师认为设备台套数不足影响教学进度  → equipment 选「不太满足/完全不满足」
 *   88.2% 学生希望增加可反复试错线上仿真      → needPlatform 选「非常需要」
 *   83.6% 院校负责人认为采购维护制约更新      → problems 含「设备损耗快」
 *   76.5% 企业认为毕业生需要二次培训          → problems 含「课程更新慢」
 * 另有两项配套口径（无外部参照，用于让多选结果自洽）：
 *   85.1% problems 含「设备数量不足」（与设备满足度呼应）
 *   72.0% problems 含「学生课后无法练习」（与线上仿真诉求呼应）
 * 实现方式：先按受访角色加权随机生成，再用配额校准把上述各项精确收敛到目标人数。
 */
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "submissions.json");
const SEED_DEFAULT = 20260828;
const TOTAL_DEFAULT = 686;

// 时间范围：2026-06-01 ~ 2026-08-28，权重向近期倾斜，模拟线上问卷逐步铺开的过程
const TIME_START = new Date("2026-06-01T08:00:00+08:00").getTime();
const TIME_END = new Date("2026-08-27T21:00:00+08:00").getTime();

// ---------------------------------------------------------------- 参数解析
const argv = process.argv.slice(2);
const flag = (name) => argv.includes("--" + name);
const value = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};

// ---------------------------------------------------------------- 确定性随机
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(value("seed", SEED_DEFAULT));
const chance = (p) => rnd() < p;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rnd() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const round = (n) => Math.round(n);

// ---------------------------------------------------------------- 选项（与 public/index.html 保持一致）
const UNIT_TYPES = ["中职", "高职", "技师学院", "企业", "教培机构", "其他"];
const COURSES = ["传感器", "单片机", "物联网通信", "PLC", "工业机器人", "智能制造", "其他"];
const PROBLEMS = ["设备数量不足", "设备损耗快", "实验危险工况难开放", "课程更新慢", "教师评价工作量大", "学生课后无法练习"];
const FEATURES = ["3D设备仿真", "虚实硬件联动", "AI操作纠错", "在线考核", "错题/实验报告生成", "教师端班级管理", "企业岗位任务包"];
const orderOf = (list, v) => list.indexOf(v);
const sortBy = (list) => (a, b) => orderOf(list, a) - orderOf(list, b);

// ---------------------------------------------------------------- 目标配额
const TOTAL = value("total", TOTAL_DEFAULT);
const TARGET = {
  // 前四项直接对应计划书中的既有调研成果，必须精确命中
  equipmentLacking: round(TOTAL * 0.914), // 不太满足 + 完全不满足
  needPlatformVery: round(TOTAL * 0.882), // 非常需要
  problemWear: round(TOTAL * 0.836), // problems 含「设备损耗快」
  problemOutdated: round(TOTAL * 0.765), // problems 含「课程更新慢」
  // 后两项为配套口径，用于让多选结果与其他题目自洽
  problemShortage: round(TOTAL * 0.851), // problems 含「设备数量不足」
  problemNoPractice: round(TOTAL * 0.72) // problems 含「学生课后无法练习」
};

// ---------------------------------------------------------------- 字段生成
// 同时兼容传入身份字符串与整条记录，避免误把记录对象塞进 includes 导致判断恒为 false
const isSchool = (v) => ["中职", "高职", "技师学院", "教培机构"].includes(typeof v === "string" ? v : v.unitType);

function genUnitType() {
  return pickWeighted([
    ["中职", 0.21],
    ["高职", 0.3],
    ["技师学院", 0.14],
    ["企业", 0.19],
    ["教培机构", 0.11],
    ["其他", 0.05]
  ]);
}

function genCourses(unit) {
  const w = isSchool(unit)
    ? [["传感器", 0.66], ["单片机", 0.5], ["物联网通信", 0.58], ["PLC", 0.6], ["工业机器人", 0.44], ["智能制造", 0.3], ["其他", 0.04]]
    : [["传感器", 0.55], ["单片机", 0.4], ["物联网通信", 0.52], ["PLC", 0.56], ["工业机器人", 0.4], ["智能制造", 0.34], ["其他", 0.08]];
  const list = COURSES.filter((c) => chance(w.find((x) => x[0] === c)[1]));
  if (!list.length) list.push(isSchool(unit) ? "传感器" : "PLC");
  if (list.length > 5) return list.slice(0, 5);
  return list;
}

function genEquipment(unit) {
  return isSchool(unit)
    ? pickWeighted([["完全满足", 0.01], ["基本满足", 0.06], ["不太满足", 0.68], ["完全不满足", 0.25]])
    : pickWeighted([["完全满足", 0.1], ["基本满足", 0.3], ["不太满足", 0.45], ["完全不满足", 0.15]]);
}

function genNeedPlatform() {
  return pickWeighted([["非常需要", 0.86], ["比较需要", 0.1], ["一般", 0.03], ["不需要", 0.01]]);
}

function genProblems(unit, equipment) {
  const school = isSchool(unit);
  // 设备类问题与第 3 题的设备满足度强相关：既然认为设备完全够用，就不该抱怨数量不足，
  // 否则后台交叉查看时会出现自相矛盾的答卷。
  const shortage = { 完全满足: 0.08, 基本满足: 0.34, 不太满足: 0.88, 完全不满足: 0.96 }[equipment];
  const wear = { 完全满足: 0.22, 基本满足: 0.42, 不太满足: 0.8, 完全不满足: 0.88 }[equipment];
  // 四项参与配额校准的问题，生成概率刻意低于目标值，由后续校准补足；
  // 补足时会优先补到勾选较少的问卷上，避免出现大量「全选」的敷衍答卷。
  const p = {
    设备数量不足: shortage * (school ? 1 : 0.7),
    设备损耗快: wear * (school ? 0.95 : 0.85),
    实验危险工况难开放: school ? 0.42 : 0.2,
    // 「课程更新慢」对应「毕业生需要二次培训」，企业更敏感，故企业勾选率明显更高。
    // 此项生成概率刻意高于目标值，让校准走「随机删减」而非「定向补足」，
    // 这样收敛后仍能保留院校与企业之间的态度差异，不会把企业补成 100%。
    课程更新慢: school ? 0.78 : 0.95,
    教师评价工作量大: school ? 0.45 : 0.1,
    学生课后无法练习: school ? 0.66 : 0.3
  };
  const list = PROBLEMS.filter((k) => chance(p[k]));
  if (!list.length) list.push(chance(0.6) ? "课程更新慢" : "学生课后无法练习");
  return list.sort(sortBy(PROBLEMS));
}

function genFeatures(unit) {
  const school = isSchool(unit);
  const p = {
    "3D设备仿真": 0.72,
    虚实硬件联动: 0.58,
    AI操作纠错: 0.63,
    在线考核: school ? 0.58 : 0.38,
    "错题/实验报告生成": school ? 0.64 : 0.4,
    教师端班级管理: school ? 0.48 : 0.15,
    企业岗位任务包: school ? 0.28 : 0.7
  };
  const list = FEATURES.filter((k) => chance(p[k]));
  if (!list.length) list.push("3D设备仿真");
  if (list.length > 5) return list.slice(0, 5);
  return list.sort(sortBy(FEATURES));
}

function genFee() {
  return pickWeighted([
    ["8000元以下", 0.24],
    ["8000—15000元", 0.38],
    ["15000—30000元", 0.21],
    ["按课程模块报价", 0.17]
  ]);
}

function genPilot(unit) {
  return unit === "企业"
    ? pickWeighted([["愿意", 0.4], ["视合作条件而定", 0.48], ["暂不考虑", 0.12]])
    : pickWeighted([["愿意", 0.53], ["视合作条件而定", 0.36], ["暂不考虑", 0.11]]);
}

// ---------------------------------------------------------------- 文字风格
// brief：真实问卷风格，短句、口语化、留空率高（默认）
// full ：汇报演示风格，句式完整、措辞正式（--verbose 启用）
const VERBOSE = flag("verbose");
const TEXT_STYLE = VERBOSE
  ? { blankPriority: 0.1, blankSuggest: 0.16, minItems: 2, twoSentence: 0.34, period: 0.55, prefix: 0.5, suffix: 0.4 }
  : { blankPriority: 0.22, blankSuggest: 0.3, minItems: 1, twoSentence: 0.13, period: 0.3, prefix: 0.15, suffix: 0.08 };

// ---------------------------------------------------------------- 自由文本模板
const COURSE_PRIORITY_BRIEF = {
  传感器: ["传感器标定", "传感器应用", "传感器选型"],
  单片机: ["单片机实训", "单片机编程", "最小系统搭建"],
  物联网通信: ["物联网组网", "通信配置", "平台接入"],
  PLC: ["PLC故障诊断", "PLC编程", "电气控制"],
  工业机器人: ["机器人示教", "机器人操作", "工作站调试"],
  智能制造: ["产线联调", "数据采集", "智能仓储"],
  其他: ["电气安装", "电子装配", "综合实训"]
};
const JOB_PRIORITY_BRIEF = {
  传感器: ["仪表维护", "传感器标定", "在线检测"],
  单片机: ["嵌入式测试", "硬件维修", "板卡调试"],
  物联网通信: ["物联网运维", "网络调试", "网关配置"],
  PLC: ["PLC调试", "电气装调", "产线维护"],
  工业机器人: ["机器人运维", "机器人操作", "集成调试"],
  智能制造: ["产线维护", "设备点检", "数据采集"],
  其他: ["装配", "维修", "售后技术"]
};
const COURSE_PRIORITY_FULL = {
  传感器: ["传感器信号采集与标定", "传感器应用技术综合实训", "智能传感器选型与调试", "光电/接近开关安装与检测", "温度传感器特性测试"],
  单片机: ["单片机最小系统搭建", "单片机 C 语言程序设计", "单片机接口技术实训", "串口通信与中断应用", "基于单片机的智能小车控制"],
  物联网通信: ["物联网通信配置（MQTT/LoRa）", "物联网云平台接入与调试", "工业网络组网与调试", "ZigBee 组网与数据采集", "边缘网关配置与数据上云"],
  PLC: ["PLC 故障诊断与顺序控制", "PLC 编程与变频器通信", "电气控制系统安装与调试", "触摸屏与 PLC 联机组态", "交通灯/传送带综合控制项目"],
  工业机器人: ["工业机器人示教编程", "工业机器人操作与运维", "机器人工作站集成调试", "机器人轨迹规划与码垛应用", "机器人与视觉系统联动"],
  智能制造: ["智能制造产线联调", "智能产线数据采集与监控", "智能仓储系统集成", "MES 系统基础操作", "柔性制造单元调度实训"],
  其他: ["电气安装与维修实训", "电子产品装配与调试", "低压电器线路故障排查"]
};
const JOB_PRIORITY_FULL = {
  传感器: ["智能仪表维护岗", "传感器标定与检测岗", "在线检测设备调试岗"],
  单片机: ["嵌入式硬件测试岗", "单片机开发助理岗", "电子产品维修岗"],
  物联网通信: ["物联网设备安装与维护岗", "工业网络运维岗", "弱电系统集成岗"],
  PLC: ["PLC 编程与调试岗", "电气设备装调岗", "自动化产线维护岗"],
  工业机器人: ["工业机器人运维岗", "机器人工作站操作岗", "机器人系统集成助理岗"],
  智能制造: ["智能产线调试岗", "自动化设备点检岗", "生产数据采集与分析岗"],
  其他: ["电子产品装配岗", "电气维修岗", "售后服务技术岗"]
};
const COURSE_PRIORITY = VERBOSE ? COURSE_PRIORITY_FULL : COURSE_PRIORITY_BRIEF;
const JOB_PRIORITY = VERBOSE ? JOB_PRIORITY_FULL : JOB_PRIORITY_BRIEF;
const PRIORITY_PREFIX = ["", "", "", "", "", "希望优先适配：", "建议首批覆盖：", "优先做：", "最急需的是", "先做"];
const PRIORITY_SUFFIX_SCHOOL = ["", "", "", "", "（最好配套企业真实案例）", "（希望能对接技能大赛考点）", "（建议从基础任务做起）", "（可与现有实验台配套使用）"];
const PRIORITY_SUFFIX_BIZ = ["", "", "", "", "（最好能覆盖现场常见故障）", "（建议按岗位等级分层）", "（可配合新员工入职培训）"];

// 措辞前缀按受访身份区分，避免企业受访者说出「结合本校实训条件」这类院校口吻。
// brief 模式的前缀刻意更短，且多数情况不加前缀——真实填卷的人很少写开场白。
const PREFIX_SCHOOL = ["", "", "", "总体来看，", "就本专业而言，", "结合本校实训条件，", "从一线教学反馈看，", "结合专业教学实际，"];
const PREFIX_BIZ = ["", "", "", "总体来看，", "站在用人角度，", "结合企业现场实际，", "从用人反馈看，", "结合产线实际，"];
const PREFIX_ANY = ["", "", "", "总体来看，", "建议", "个人认为，"];
const PREFIX_BRIEF = ["", "", "", "", "", "希望", "建议", "最好"];

const S = (t, a) => ({ t, a }); // a: school | any | biz
const SUGGESTIONS_BRIEF = {
  equip: [
    S("设备太少，希望能多配几台。", "school"),
    S("设备损耗快，维护成本太高。", "any"),
    S("预算有限，希望价格低一点。", "school"),
    S("设备更新太慢，跟不上技术。", "any"),
    S("希望能替代一部分实体设备。", "school"),
    S("老设备也能用就更好了。", "school"),
    S("耗材太费钱。", "any"),
    S("希望能少花钱。", "any")
  ],
  teach: [
    S("希望学生课后也能练。", "school"),
    S("课程跟不上企业需求。", "school"),
    S("批改工作量太大。", "school"),
    S("希望能配套课件和评分标准。", "school"),
    S("希望能对接技能大赛。", "school"),
    S("学生基础差，希望有入门任务。", "school"),
    S("建议给老师做点培训。", "school"),
    S("内容和现场脱节。", "biz")
  ],
  feature: [
    S("危险工况不敢实操。", "any"),
    S("希望有 AI 纠错。", "any"),
    S("希望能自动生成实验报告。", "any"),
    S("希望能回放操作过程。", "any"),
    S("希望支持手机访问。", "any"),
    S("别卡顿，运行要流畅。", "any"),
    S("希望能和实体设备联动。", "any"),
    S("希望能看懂内部结构。", "any")
  ],
  job: [
    S("毕业生到岗还得重新培训。", "any"),
    S("建议按企业岗位做实训。", "any"),
    S("希望能有真实案例。", "biz"),
    S("希望能支撑新员工培训。", "biz"),
    S("希望能看学生操作数据。", "any"),
    S("标准更新太慢。", "any"),
    S("建议引入企业导师。", "any")
  ],
  // 真实问卷里大量是这类一句话敷衍回答，brief 模式下给一定权重
  short: [
    S("无。", "any"),
    S("没有。", "any"),
    S("挺好的。", "any"),
    S("支持，希望尽快上线。", "any"),
    S("先试点看看效果。", "any"),
    S("建议先做 PLC 的。", "any"),
    S("希望能好用一点。", "any"),
    S("暂时没想到。", "any")
  ]
};
const SUGGESTIONS_FULL = {
  // 设备与成本
  equip: [
    S("实验设备台套数不足，建议优先上线传感器与 PLC 模块，让学生能课后反复练习，缓解排课压力。", "school"),
    S("实体设备损耗快、维护成本高，希望虚拟仿真承担大部分基础操作训练，实体设备只做综合实训。", "any"),
    S("采购预算有限，建议按课程模块报价，先采购最急需的两三个模块试点，见效后再逐步扩展。", "school"),
    S("设备更新周期长，跟不上产业技术迭代，希望平台内容与主流设备型号保持同步更新。", "any"),
    S("实训室建设投入大但利用率有限，用虚拟平台补位能显著降低人均设备成本。", "school"),
    S("希望提供老旧设备的仿真替代方案，不必淘汰现有实验台即可开出新实验。", "school"),
    S("耗材与元器件损耗是一笔长期开支，虚拟仿真可以省下这部分预算用于师资培训。", "any")
  ],
  // 教学与课程
  teach: [
    S("希望增加教师端班级管理与学情看板，自动记录操作过程，减轻批改与评价工作量。", "school"),
    S("课程内容更新慢，与岗位实际需求脱节，建议直接接入企业真实岗位任务包组织实训。", "school"),
    S("学生课后无法练习，希望平台支持普通机房甚至手机访问，降低使用门槛。", "school"),
    S("希望配套实验指导书、评分标准与课件，方便直接嵌入现有课程体系，不必另起炉灶。", "school"),
    S("建议按 1+X 证书与技能大赛的考核点来设计实训任务，兼顾日常教学与赛证训练。", "school"),
    S("学生基础差异大，希望任务能分层设置，基础薄弱的学生也有可完成的入门路径。", "school"),
    S("建议增加教师培训与答疑支持，让不熟悉信息化的老教师也能快速上手。", "school"),
    S("教学内容与企业现场脱节，希望平台能定期同步行业新工艺、新标准。", "biz")
  ],
  // 功能与安全
  feature: [
    S("危险工况（短路、过载、机械伤害）在实体实训中不敢开放，希望虚拟环境能安全演示并自动纠错。", "any"),
    S("希望 AI 能实时纠正接线与编程错误，并生成错题本和实验报告，减少重复讲解。", "any"),
    S("建议支持虚实硬件联动，学生在虚拟环境中调试通过后可直接下载到实体设备验证。", "any"),
    S("希望增加 3D 设备拆装与内部结构展示，帮助学员理解原理而不只是会连线。", "any"),
    S("希望操作过程能完整回放，方便复盘出错的具体环节。", "any"),
    S("建议支持多人协同任务，模拟产线班组的分工配合，贴近真实工作场景。", "any"),
    S("希望平台运行稳定、对机房配置要求不要太高，避免出现卡顿影响课堂节奏。", "any")
  ],
  // 企业与就业
  job: [
    S("毕业生到岗后仍需较长时间二次培训，建议平台按企业真实岗位任务组织实训内容。", "any"),
    S("愿意提供真实岗位案例与设备资料参与试点，希望平台能覆盖现场常见故障与处理方法。", "biz"),
    S("希望能输出学员操作过程数据，作为招聘与实习评价的客观参考。", "any"),
    S("建议建立行业新工艺、新标准的同步更新机制，让教学内容与岗位要求保持一致。", "any"),
    S("希望平台能支撑新员工岗前训练，降低企业内部的培训成本与培训周期。", "biz"),
    S("建议引入企业导师点评环节，让学生在校期间就能接触到工程现场的评判标准。", "any")
  ]
};
const SUGGESTIONS = VERBOSE ? SUGGESTIONS_FULL : SUGGESTIONS_BRIEF;
const poolFor = (cat, biz) => SUGGESTIONS[cat].filter((s) => (biz ? s.a !== "school" : s.a !== "biz"));

function genPriority(item) {
  if (chance(TEXT_STYLE.blankPriority)) return "";
  // 企业用岗位任务表述，「其他」身份两类都可能，随机取其一
  const biz = item.unitType === "企业" || (item.unitType === "其他" && chance(0.4));
  const map = biz ? JOB_PRIORITY : COURSE_PRIORITY;
  const pool = shuffle(item.courses.filter((c) => c !== "其他"));
  const n = Math.max(TEXT_STYLE.minItems, Math.min(pool.length || 1, chance(0.62) ? 3 : 2));
  const source = pool.length ? pool.slice(0, n) : [pick(COURSES.filter((c) => c !== "其他"))];
  const body = source.map((c) => pick(map[c])).join("、");
  const prefix = chance(TEXT_STYLE.prefix) ? pick(PRIORITY_PREFIX) : "";
  const suffix = chance(TEXT_STYLE.suffix) ? pick(biz ? PRIORITY_SUFFIX_BIZ : PRIORITY_SUFFIX_SCHOOL) : "";
  return prefix + body + suffix + (chance(TEXT_STYLE.period) ? "。" : "");
}

function genSuggestions(item) {
  if (chance(TEXT_STYLE.blankSuggest)) return "";
  const biz = item.unitType === "企业";
  const other = item.unitType === "其他";
  // brief 模式额外保留 short 类（一句话敷衍回答），真实问卷里这类占比不低
  const w = VERBOSE
    ? biz
      ? [["job", 0.36], ["equip", 0.3], ["feature", 0.24], ["teach", 0.1]]
      : [["teach", 0.3], ["feature", 0.28], ["equip", 0.28], ["job", 0.14]]
    : biz
      ? [["job", 0.3], ["equip", 0.24], ["feature", 0.2], ["short", 0.18], ["teach", 0.08]]
      : [["teach", 0.24], ["feature", 0.22], ["equip", 0.22], ["short", 0.2], ["job", 0.12]];
  const c1 = pickWeighted(w);
  let text = pick(poolFor(c1, biz)).t;
  if (chance(TEXT_STYLE.twoSentence)) {
    const rest = w.filter((x) => x[0] !== c1);
    text += pick(poolFor(pickWeighted(rest), biz)).t;
  }
  // 短句模板本身常以「希望」「建议」开头，前缀需先查重，否则会拼出「希望希望有 AI 纠错」
  const raw = VERBOSE ? (other ? pick(PREFIX_ANY) : pick(biz ? PREFIX_BIZ : PREFIX_SCHOOL)) : chance(TEXT_STYLE.prefix) ? pick(PREFIX_BRIEF) : "";
  const prefix = raw && !text.startsWith(raw) ? raw : "";
  return prefix + text;
}

// ---------------------------------------------------------------- 配额校准
/**
 * 把某项特征的命中人数精确收敛到 target。
 * rank 用于给候选记录排序（数值越小越优先被补足），
 * 保证补足后既精确命中配额，又不产生自相矛盾或敷衍的答卷。
 */
function calibrate(items, target, has, add, remove, rank) {
  const hit = items.filter(has);
  if (hit.length < target) {
    const pool = shuffle(items.filter((x) => !has(x)));
    if (rank) pool.sort((a, b) => rank(a) - rank(b));
    pool.slice(0, target - hit.length).forEach(add);
  } else if (hit.length > target) {
    shuffle(hit)
      .slice(0, hit.length - target)
      .forEach(remove);
  }
}
const dropProblem = (name) => (x) => {
  const next = x.problems.filter((p) => p !== name);
  if (!next.length) return; // 删空就不删，避免出现未作答的空白答卷
  x.problems = next;
};

// ---------------------------------------------------------------- 时间戳
function genTimestamp() {
  for (let i = 0; i < 12; i++) {
    // u 的幂次 < 1 → 采样值向 1（近期）倾斜
    const t = TIME_START + (TIME_END - TIME_START) * Math.pow(rnd(), 0.62);
    const d = new Date(t);
    const day = d.getDay();
    const hour = d.getHours();
    const weekend = day === 0 || day === 6;
    if (weekend && !chance(0.25)) continue; // 周末提交量明显更少
    if (hour < 7 || hour > 22) continue; // 只保留白天与晚间时段
    return t;
  }
  return TIME_START + (TIME_END - TIME_START) * rnd();
}

// ---------------------------------------------------------------- 主流程
function generate() {
  const items = [];
  for (let i = 0; i < TOTAL; i++) {
    const unitType = genUnitType();
    const equipment = genEquipment(unitType);
    const item = {
      unitType,
      courses: genCourses(unitType),
      equipment,
      problems: genProblems(unitType, equipment),
      needPlatform: genNeedPlatform(),
      platformFeatures: genFeatures(unitType),
      fee: genFee(),
      pilot: genPilot(unitType)
    };
    items.push(item);
  }

  // 多选题补足时的排序依据：议题相符的记录享有绝对优先权（+0 vs +100），
  // 同组内再优先补到勾选较少的问卷上，避免补出「全选」的敷衍答卷。
  // 注意：权重差必须足够大，否则议题不符的记录会凭借「勾选少」挤到前面，
  // 补出「认为设备完全够用、却抱怨设备数量不足」这类自相矛盾的问卷。
  const rankBy = (match) => (x) => (match(x) ? 0 : 100) + x.problems.length * 3;

  // —— 校准 1：设备台套数不足影响教学进度 → 91.4%
  calibrate(
    items,
    TARGET.equipmentLacking,
    (x) => x.equipment === "不太满足" || x.equipment === "完全不满足",
    (x) => {
      x.equipment = chance(0.74) ? "不太满足" : "完全不满足";
    },
    (x) => {
      x.equipment = chance(0.86) ? "基本满足" : "完全满足";
    },
    (x) => (isSchool(x.unitType) ? 0 : 1)
  );

  // —— 校准 2：希望增加可反复试错的线上仿真 → 88.2%
  calibrate(
    items,
    TARGET.needPlatformVery,
    (x) => x.needPlatform === "非常需要",
    (x) => {
      x.needPlatform = "非常需要";
    },
    (x) => {
      x.needPlatform = pickWeighted([["比较需要", 0.76], ["一般", 0.19], ["不需要", 0.05]]);
    },
    (x) => (x.unitType === "企业" ? 1 : 0)
  );

  // —— 以下为多选题校准，按目标占比从高到低依次收敛 ——
  const lacking = (x) => x.equipment === "不太满足" || x.equipment === "完全不满足";
  // 校准 3：设备数量不足 → 85%（与 91.4% 的设备满足度口径相呼应，避免自相矛盾）
  calibrate(
    items,
    TARGET.problemShortage,
    (x) => x.problems.includes("设备数量不足"),
    (x) => {
      x.problems.push("设备数量不足");
    },
    dropProblem("设备数量不足"),
    rankBy(lacking)
  );

  // 校准 4：采购维护制约设备更新 → 83.6%
  calibrate(
    items,
    TARGET.problemWear,
    (x) => x.problems.includes("设备损耗快"),
    (x) => {
      x.problems.push("设备损耗快");
    },
    dropProblem("设备损耗快"),
    rankBy(lacking)
  );

  // 校准 5：毕业生需要二次培训（课程内容滞后）→ 76.5%
  // 该议题源于企业反馈，故补足时企业受访者优先
  calibrate(
    items,
    TARGET.problemOutdated,
    (x) => x.problems.includes("课程更新慢"),
    (x) => {
      x.problems.push("课程更新慢");
    },
    dropProblem("课程更新慢"),
    rankBy((x) => x.unitType === "企业")
  );

  // 校准 6：学生课后无法练习 → 72%（与 88.2% 的线上仿真诉求互为印证）
  calibrate(
    items,
    TARGET.problemNoPractice,
    (x) => x.problems.includes("学生课后无法练习"),
    (x) => {
      x.problems.push("学生课后无法练习");
    },
    dropProblem("学生课后无法练习"),
    rankBy(isSchool)
  );

  // 统一排序 + 生成文本 + 时间戳 + id
  const stamps = Array.from({ length: TOTAL }, genTimestamp).sort((a, b) => a - b);
  return items.map((item, i) => {
    item.problems = item.problems.slice().sort(sortBy(PROBLEMS));
    item.courses = item.courses.slice().sort(sortBy(COURSES));
    item.platformFeatures = item.platformFeatures.slice().sort(sortBy(FEATURES));
    const submittedAt = new Date(stamps[i]).toISOString();
    const record = {
      id: new Date(stamps[i]).getTime().toString(36) + "-" + Math.floor(rnd() * 1e6).toString(36),
      submittedAt,
      unitType: item.unitType,
      courses: item.courses,
      equipment: item.equipment,
      problems: item.problems,
      needPlatform: item.needPlatform,
      platformFeatures: item.platformFeatures,
      fee: item.fee,
      pilot: item.pilot,
      priority: genPriority(item),
      suggestions: genSuggestions(item),
      demo: true
    };
    return record;
  });
}

// ---------------------------------------------------------------- 统计与校验
function summarize(list) {
  const n = list.length || 1;
  const pct = (v) => ((v / n) * 100).toFixed(1) + "%";
  const countBy = (key) =>
    list.reduce((m, x) => {
      const v = x[key];
      if (Array.isArray(v)) v.forEach((a) => (m[a] = (m[a] || 0) + 1));
      else if (v) m[v] = (m[v] || 0) + 1;
      return m;
    }, {});
  const lack = list.filter((x) => x.equipment === "不太满足" || x.equipment === "完全不满足").length;
  const very = list.filter((x) => x.needPlatform === "非常需要").length;
  const wear = list.filter((x) => x.problems.includes("设备损耗快")).length;
  const outdated = list.filter((x) => x.problems.includes("课程更新慢")).length;
  return {
    total: list.length,
    unitType: countBy("unitType"),
    courses: countBy("courses"),
    problems: countBy("problems"),
    equipment: countBy("equipment"),
    needPlatform: countBy("needPlatform"),
    platformFeatures: countBy("platformFeatures"),
    fee: countBy("fee"),
    pilot: countBy("pilot"),
    avgProblems: (list.reduce((s, x) => s + x.problems.length, 0) / n).toFixed(2),
    align: [
      { name: "设备台套数不足影响教学进度", target: "91.4%", actual: pct(lack), count: lack, ok: Math.abs(lack / n - 0.914) < 0.005 },
      { name: "希望增加可反复试错线上仿真", target: "88.2%", actual: pct(very), count: very, ok: Math.abs(very / n - 0.882) < 0.005 },
      { name: "采购维护制约设备更新", target: "83.6%", actual: pct(wear), count: wear, ok: Math.abs(wear / n - 0.836) < 0.005 },
      { name: "毕业生需要二次培训（课程滞后）", target: "76.5%", actual: pct(outdated), count: outdated, ok: Math.abs(outdated / n - 0.765) < 0.005 },
      { name: "· 设备数量不足（配套口径）", target: "85.1%", actual: pct(list.filter((x) => x.problems.includes("设备数量不足")).length), count: list.filter((x) => x.problems.includes("设备数量不足")).length, ok: null },
      { name: "· 学生课后无法练习（配套口径）", target: "72.0%", actual: pct(list.filter((x) => x.problems.includes("学生课后无法练习")).length), count: list.filter((x) => x.problems.includes("学生课后无法练习")).length, ok: null }
    ]
  };
}
const fmtDist = (obj, n) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}(${((v / n) * 100).toFixed(1)}%)`)
    .join("  ");

// ---------------------------------------------------------------- 执行
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

if (flag("clear")) {
  const before = readData();
  const kept = before.filter((x) => !x.demo);
  fs.writeFileSync(DATA_FILE, JSON.stringify(kept, null, 2), "utf8");
  console.log(`已清除演示数据 ${before.length - kept.length} 条，保留真实提交 ${kept.length} 条。`);
  process.exit(0);
}

const existing = readData();
const real = existing.filter((x) => !x.demo);
const demo = generate();

// 演示数据在前、真实提交在后，并按时间排序，保证「最新提交」展示的是最近数据
const merged = flag("append") ? existing.concat(demo) : real.concat(demo);
merged.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), "utf8");

const s = summarize(demo);
console.log(`\n已生成演示数据 ${s.total} 条 → ${path.relative(process.cwd(), DATA_FILE)}`);
console.log(`文件中合计 ${merged.length} 条（其中真实提交 ${real.length} 条）`);
console.log("\n【与既有调研成果的对齐校验】");
s.align.forEach((a) => {
  const mark = a.ok === null ? "·" : a.ok ? "✓" : "✗";
  console.log(`  ${mark} ${a.name}：目标 ${a.target}  实际 ${a.actual}（${a.count}/${s.total}）`);
});
console.log("\n【实时分布】");
console.log("  单位类型   ", fmtDist(s.unitType, s.total));
console.log("  实训课程   ", fmtDist(s.courses, s.total));
console.log("  设备满足度 ", fmtDist(s.equipment, s.total));
console.log("  突出问题   ", fmtDist(s.problems, s.total));
console.log("  平台需求   ", fmtDist(s.needPlatform, s.total));
console.log("  关注功能   ", fmtDist(s.platformFeatures, s.total));
console.log("  年度费用   ", fmtDist(s.fee, s.total));
console.log("  试点意愿   ", fmtDist(s.pilot, s.total));
const withText = demo.filter((x) => x.priority || x.suggestions).length;
const uniqPriority = new Set(demo.map((x) => x.priority).filter(Boolean)).size;
const uniqSuggest = new Set(demo.map((x) => x.suggestions).filter(Boolean)).size;
const avgLen = (key) => {
  const arr = demo.map((x) => x[key] || "").filter(Boolean);
  return arr.length ? (arr.reduce((t, v) => t + v.length, 0) / arr.length).toFixed(1) : "0.0";
};
console.log(`\n文字风格：${VERBOSE ? "full 完整书面（--verbose）" : "brief 简短口语（默认）"}`);
console.log(`平均长度：优先课程 ${avgLen("priority")} 字 / 建议 ${avgLen("suggestions")} 字`);
console.log(`平均勾选问题 ${s.avgProblems} 项；含自由文本 ${withText} 条`);
console.log(`文本去重：优先课程 ${uniqPriority} 种表述 / 建议 ${uniqSuggest} 种表述；文件 ${(fs.statSync(DATA_FILE).size / 1024).toFixed(0)} KB`);
console.log("清除演示数据：node scripts/generate-demo-data.js --clear\n");
