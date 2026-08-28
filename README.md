# 智联筑境｜前期调研问卷平台

## 功能
- `/`：学生、教师、企业技术人员、教培机构负责人填写问卷。
- `/admin`：管理员后台，查看实时问卷数量、选项分布、已有调研成果、最新提交记录。
- 后台 8 项实时分布统计：单位类型、实训课程、设备满足度、实训最突出问题、平台需求、平台功能、年度费用、试点意愿。
- 后台「文字详情与检索」：跨全部字段模糊检索、可翻页浏览全部提交，并对自由文本做领域关键词词频统计。
- 支持 CSV 导出（含「实训最突出问题」「数据来源」列）。
- 数据保存在 `data/submissions.json`，无需数据库。
- 提交限流：同一 IP 每小时最多 20 次，超出返回 429，避免刷量污染调研数据。
- 入参清洗：单条文本上限 1000 字、选项上限 20 项且自动去重。
- 前端为原生 HTML/CSS/JS，后端为 Node.js + Express。

## 演示数据
内置生成器可造出与「项目既有调研成果」口径一致的演示问卷，用于汇报与界面走查。

```bash
node scripts/generate-demo-data.js            # 生成 686 条（默认，简短口语风）
node scripts/generate-demo-data.js --verbose  # 生成完整书面风（句式较长，适合汇报）
node scripts/generate-demo-data.js --total 200  # 指定条数，比例仍按百分比换算
node scripts/generate-demo-data.js --seed 42    # 换随机种子
node scripts/generate-demo-data.js --append     # 追加而非覆盖
node scripts/generate-demo-data.js --clear      # 仅清除演示数据，保留真实提交
```

两种文字风格对比（实测平均值）：

| 风格 | 优先课程 | 建议 | 适用 |
| --- | --- | --- | --- |
| `brief`（默认） | 13.3 字 | 11.0 字 | 接近真实填卷：短句、口语化，含留空与「无」「暂时没想到」这类敷衍回答 |
| `full`（`--verbose`） | 30.8 字 | 57.9 字 | 汇报演示：句式完整、措辞正式 |

### 想改数据改哪里

| 想改什么 | 改哪个位置 |
| --- | --- |
| 生成条数 | 命令行 `--total`，或脚本内 `TOTAL_DEFAULT` |
| 时间范围 | `TIME_START` / `TIME_END` |
| 随机种子 | 命令行 `--seed` |
| 各类单位占比 | `genUnitType()` 的权重表 |
| 各题选项占比 | `genCourses` / `genEquipment` / `genProblems` / `genFeatures` / `genFee` / `genPilot`，每个函数顶部都是 `[[选项, 权重], ...]` 表 |
| 对齐目标百分比 | `TARGET` 常量 |
| 文字内容 | `SUGGESTIONS_BRIEF` / `SUGGESTIONS_FULL`（建议）、`COURSE_PRIORITY_BRIEF` / `_FULL`、`JOB_PRIORITY_BRIEF` / `_FULL`（优先课程） |
| 文字长短与留空率 | `TEXT_STYLE` 的 `blankPriority` / `blankSuggest` / `twoSentence` / `period` / `prefix` |
| 后台词云关键词 | `server.js` 的 `TOPICS` 数组 |

改完重新执行脚本即可，**服务无需重启**（每次请求都重新读数据文件）。

演示数据带 `demo: true` 标记，真实问卷提交不带该字段，两者可干净分离：
- 后台「实时回收问卷」下方会显示「含演示数据 N 条」，并出现「清除演示数据」按钮（需二次确认）；
- CSV 导出多一列「数据来源」，标注「演示数据 / 真实提交」。

**对齐口径**（对应计划书中的既有调研成果，生成后精确命中）：

| 既有调研成果 | 对应字段 | 目标 |
| --- | --- | --- |
| 91.4% 教师认为设备台套数不足影响教学进度 | `equipment` 不太满足 + 完全不满足 | 91.4% |
| 88.2% 学生希望增加可反复试错线上仿真 | `needPlatform` 非常需要 | 88.2% |
| 83.6% 院校负责人认为采购维护制约更新 | `problems` 含「设备损耗快」 | 83.6% |
| 76.5% 企业认为毕业生需要二次培训 | `problems` 含「课程更新慢」 | 76.5% |

另外两项配套口径用于让多选结果自洽：85.1% 含「设备数量不足」、72.0% 含「学生课后无法练习」。
数据还做了交叉一致性处理——例如认为设备「完全满足」的受访者不会抱怨「设备数量不足」，
企业受访者不会说出「本校实训条件」这类院校口吻。

> 注：83.6% 在 686 人的离散粒度下实际为 83.5%（573/686），误差 0.1 个百分点，属取整限制。

## 环境变量
| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `ADMIN_PASSWORD` | `admin123456` | 管理员后台密码 |

## 启动
1. 安装 Node.js 18+。
2. 在本文件夹打开终端。
3. 执行：
   ```bash
   npm install
   npm start
   ```
4. 浏览器访问：
   - 问卷：http://localhost:3000/
   - 管理后台：http://localhost:3000/admin
5. 默认管理员密码：`admin123456`

生产环境建议修改环境变量 `ADMIN_PASSWORD`，并部署到带 HTTPS 的服务器。
