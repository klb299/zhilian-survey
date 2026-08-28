const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123456";
const DATA_FILE = path.join(__dirname, "data", "submissions.json");
const DATA_DIR = path.join(__dirname, "data");
const SEED_FILE = path.join(DATA_DIR, "demo-seed.json");

/**
 * 存储初始化：部署到全新环境（容器 / 云主机）时，保证数据目录与数据文件存在。
 * 若不存在实时数据文件，则载入仓库内置的演示数据种子，
 * 使线上后台首次打开即可看到既有调研成果。
 * 演示条目均带 demo:true，后台可一键清除，不会与真实提交混淆。
 */
(function ensureStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
  if (!fs.existsSync(DATA_FILE)) {
    try {
      fs.copyFileSync(SEED_FILE, DATA_FILE);
    } catch {
      try {
        fs.writeFileSync(DATA_FILE, "[]", "utf8");
      } catch {}
    }
  }
})();

// 提交限流：同一 IP 在时间窗口内最多允许 max 次提交，避免刷量污染调研数据
const RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 };
const hits = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}
function adminAuth(req, res, next) {
  const token = req.headers["x-admin-password"];
  if (!token || token !== ADMIN_PASSWORD) return res.status(401).json({ error: "管理员密码错误" });
  next();
}

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    return res.status(429).json({ error: "提交过于频繁，请稍后再试" });
  }
  recent.push(now);
  hits.set(ip, recent);
  // 表过大时顺手清理过期记录，防止长期运行内存缓慢增长
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      const alive = v.filter(t => now - t < RATE_LIMIT.windowMs);
      if (alive.length) hits.set(k, alive);
      else hits.delete(k);
    }
  }
  next();
}

// 入参清洗：限制文本长度与选项个数，避免超长内容写入存储
const MAX_TEXT = 1000;
const MAX_ITEM = 100;
const MAX_ITEMS = 20;
function cleanText(v) {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}
function cleanList(v) {
  if (!Array.isArray(v)) return [];
  const list = v
    .filter(x => typeof x === "string" && x.trim())
    .map(x => x.trim().slice(0, MAX_ITEM));
  return [...new Set(list)].slice(0, MAX_ITEMS);
}
function cleanOne(v) {
  return typeof v === "string" ? v.trim().slice(0, MAX_ITEM) : "";
}

app.post("/api/submissions", rateLimit, (req, res) => {
  const body = req.body || {};
  const required = ["unitType", "courses", "problems", "equipment", "needPlatform", "platformFeatures", "fee", "pilot"];
  for (const key of required) {
    if (!body[key] || (Array.isArray(body[key]) && body[key].length === 0)) {
      return res.status(400).json({ error: `缺少必填项：${key}` });
    }
  }
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    submittedAt: new Date().toISOString(),
    unitType: cleanOne(body.unitType),
    courses: cleanList(body.courses),
    problems: cleanList(body.problems),
    equipment: cleanOne(body.equipment),
    needPlatform: cleanOne(body.needPlatform),
    platformFeatures: cleanList(body.platformFeatures),
    fee: cleanOne(body.fee),
    pilot: cleanOne(body.pilot),
    priority: cleanText(body.priority),
    suggestions: cleanText(body.suggestions)
  };
  const data = readData();
  data.push(item);
  writeData(data);
  res.json({ ok: true, id: item.id });
});

app.get("/api/admin/stats", adminAuth, (req, res) => {
  const data = readData();
  const count = data.length;
  const countBy = (key) => data.reduce((m, x) => {
    const v = x[key];
    if (Array.isArray(v)) v.forEach(a => m[a] = (m[a] || 0) + 1);
    else if (v) m[v] = (m[v] || 0) + 1;
    return m;
  }, {});
  res.json({
    count,
    demoCount: data.filter((x) => x.demo).length,
    unitType: countBy("unitType"),
    courses: countBy("courses"),
    problems: countBy("problems"),
    equipment: countBy("equipment"),
    needPlatform: countBy("needPlatform"),
    platformFeatures: countBy("platformFeatures"),
    fee: countBy("fee"),
    pilot: countBy("pilot"),
    submissions: data.slice().reverse().slice(0, 200)
  });
});

// 一键清除演示数据，保留真实提交（演示数据与真实问卷混合后必须能干净分离）
app.delete("/api/admin/demo", adminAuth, (req, res) => {
  const data = readData();
  const kept = data.filter((x) => !x.demo);
  writeData(kept);
  res.json({ ok: true, removed: data.length - kept.length, remaining: kept.length });
});

app.get("/api/admin/export", adminAuth, (req, res) => {
  const data = readData();
  const header = ["时间","单位/专业类型","实训课程","设备满足度","实训最突出问题","平台需求","平台功能","年度费用","试点意愿","优先课程/岗位","其他建议","数据来源"];
  const rows = data.map(x => [
    x.submittedAt, x.unitType, (x.courses||[]).join("、"), x.equipment, (x.problems||[]).join("、"),
    x.needPlatform, (x.platformFeatures||[]).join("、"), x.fee, x.pilot, x.priority || "", x.suggestions || "",
    x.demo ? "演示数据" : "真实提交"
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''survey-data.csv");
  res.send("\ufeff" + csv);
});

// 后台「文字详情与检索」：关键词过滤 + 分页 + 字段级词频统计
const TOPICS = ["传感器","单片机","物联网","物联网通信","PLC","工业机器人","智能制造","通信","实训","设备","教学","考核","就业","实习","企业","课程","虚拟仿真","AI","操作","故障","维护","成本","师资","课后","安全","危险","嵌入式","数据采集","联网"];
app.get("/api/admin/submissions", adminAuth, (req, res) => {
  const data = readData();
  const q = (req.query.q || "").trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(req.query.size || "20", 10) || 20));
  let filtered = data;
  if (q) {
    filtered = data.filter(x => {
      const hay = [x.unitType, (x.courses || []).join(" "), (x.problems || []).join(" "), x.equipment,
        x.needPlatform, (x.platformFeatures || []).join(" "), x.fee, x.pilot, x.priority, x.suggestions]
        .join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  const total = filtered.length;
  const items = filtered.slice((page - 1) * size, page * size);
  // 关键词词频基于全部提交的「建议 + 优先课程/岗位」自由文本（反映整体主题，不随检索词变化）
  const freq = {};
  for (const x of data) {
    const text = (x.priority || "") + " " + (x.suggestions || "");
    for (const kw of TOPICS) if (text.includes(kw)) freq[kw] = (freq[kw] || 0) + 1;
  }
  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  res.json({ total, page, size, items, keywords });
});

// /api 前缀的未知路径返回 JSON，而不是被下面的兜底路由塞回 index.html
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`智联筑境问卷平台已启动：http://localhost:${PORT}`));
