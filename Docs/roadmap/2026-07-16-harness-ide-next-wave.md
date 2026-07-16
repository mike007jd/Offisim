# Harness / IDE 下一波 Roadmap(2026-07-16)

按 2026-07-16 当前资料核对(opencode v1.18.2、t3code、Claude Code、Codex、Cursor 3.11、Amp、Crush、Gemini CLI/Jules、Copilot Agent HQ 官方文档),对照 Offisim 现状与 19 个在飞 PR(#50-#68)后的**增量**规划。不与在飞 PR 重叠。

## 0. 行业基线对照(2026-07 标配线 × Offisim 现状)

2026 年中「不掉队」标配:MCP + AGENTS.md + Agent Skills 三标准、checkpoint/rewind、自动 compaction、subagent、分层审批 + 沙箱 + allowlist、自动跑测试迭代、PR 产出。

| # | 标配/差异化能力 | Offisim 现状 | 结论 |
|---|---|---|---|
| 1 | MCP | 有(always-on MCP) | ✅ |
| 2 | Agent Skills(SKILL.md) | 有(P6,Pi additionalSkillPaths) | ✅ |
| 3 | AGENTS.md 跨工具标准 | 未确认项目工作区的 AGENTS.md 是否注入员工上下文 | 小缺口,W1 顺带 |
| 4 | 分层审批 + allowlist | 有(plan<ask<auto<full + 能力清单) | ✅ |
| 5 | subagent / 并行编排 | 有(delegate + worktree 隔离) | ✅ |
| 6 | loop-until-green / git-PR 闭环 | 有(P4/P5) | ✅ |
| 7 | 定时/循环自动化 | 有(P6 Loops)+ #60 自然语言在飞 | ✅ |
| 8 | 会话持久控制(steer/stop/resume/附件) | #58 在飞 | 在飞 |
| 9 | 多引擎网关(Agent HQ / t3code 路线) | #55/#57/#59 在飞 | 在飞 |
| 10 | **checkpoint / rewind(改动快照+一键回滚)** | **无**(仅 enhance 级 undo) | ❌ **W1** |
| 11 | **diff 审阅工作台**(split/hunk/批注/部分采纳) | DiffPanel 仅 99 行纯文本渲染 | ❌ **W2** |
| 12 | **LSP 诊断回喂**(Crush/opencode 差异化) | 无 | ❌ W3 |
| 13 | **会话/产出全文搜索**(Cursor 3.11 独有→跟进) | 无 | ❌ W4 |
| 14 | **best-of-N 多员工比稿**(Cursor /best-of-n) | 无,但 worktree 隔离已具备地基 | ❌ W5(差异化) |
| 15 | 跨会话员工记忆成长(Claude/Jules/Cursor Memories) | 无 | W6(差异化,连玩具化人设) |
| 16 | session 分享链接 | 无 | 不做(桌面单机定位,PR 即协作出口) |
| 17 | 移动遥控 / cloud agent | 无 | 不做(超出产品阶段) |

## 1. 竞品定位结论(一句话)

- **t3code**(Theo/Ping,14k+ stars):与 Offisim 同类——多 harness 编排 GUI(接 Codex/Claude Code/Cursor/opencode),核心资产是 worktree-per-task + 三面板 diff 审阅 + 一键 commit/push/PR。Offisim 的引擎网关(#55/#57)落地后与它正面同构,差异化靠公司隐喻 + 审阅闭环深度。
- **opencode**(anomalyco,v1.18.2):TUI 阵营在往桌面 GUI 收敛(Desktop v2 + Tabs 主 shell),验证了「agent 车队仪表盘」是 2026 GUI 竞争主战场——Offisim 的 Office/Board 舞台方向正确,拼的是审阅与回滚的完成度。

## 2. Roadmap(已拍板顺序)

### W1 — 改动安全网:checkpoint / rewind(标配缺口,信任地基)

**产品行为**:员工每次动项目文件前自动留快照;会话时间线上每个「改动步」可见、可展开、可一键回滚到任意步;回滚是显式动作并留痕(谁、何时、回到哪步)。Stop/失败后的半成品改动也能整体撤掉。

- 实现锚点:git-backed 快照(参考 Claude Code rewind / Gemini shadow-git / opencode git-backed undo-redo),依托现有 lease-manager + worktree 体系;不引入自研版本存储。
- 边界:只管项目工作区文件,不管会话文本(Pi 拥有 session tree);与 #53/#54 workspace 绑定/恢复衔接,等其合入后动工。
- 顺带:项目工作区若存在 `AGENTS.md`,注入员工上下文(跨工具标准,28+ 工具已支持)。
- 验收:live 场景——员工改错 3 个文件 → 时间线选中第 N 步回滚 → 文件系统与 UI 一致;崩溃重启后快照链不断。

### W2 — 审阅工作台:把 DiffPanel 升级为一等审阅面(IDE 主力面)

**产品行为**:需求卡的产出从「文本 diff 列表」升级为真正审阅台——文件树分组、unified/split 双模式、hunk 级展开折叠、**批注即指令**(在某段 diff 上写评论,直接变成对该员工的 steer 修改指令)、逐文件/逐 hunk 采纳或打回、最终一键走既有 git-PR 闭环。

- 对标:t3code 三面板 diff 审阅 + PR 预填;Copilot「review→自动 fix PR」闭环的桌面化演绎。
- 依赖:#58(steer 语义)合入;复用 P5 的 gh_exec 通道。
- 边界:不做完整代码编辑器——GUI 保持 thin,人只审阅和批注,修改永远由员工执行(符合 agent-agnostic GUI 准则)。
- 验收:live 场景——一张需求卡产出 10+ 文件变更,split 视图审阅、两处批注打回、员工修完回来、逐文件采纳、建 PR。

### W3 — 代码理解:LSP 诊断回喂(终端派差异化,Crush/opencode 已验证)

**产品行为**:员工改完文件即刻收到该文件的类型错误/诊断(不必等整仓 build),自动进入下一轮修复;玩家在审阅台同样看到诊断标记。

- 实现锚点:按语言自动检测/启动 language server(opencode 模式),诊断经 DesktopAgentRuntime 中性事件回喂;放 Pi extension 缝,不动 Pi agent loop。
- 降级:LSP 不可用时静默回退到现有 loop-until-green 全量检查,不加配置项。
- 验收:live 场景——员工引入一个类型错误,不跑 build 即在下一轮自动修复。

### W4 — 全局搜索:会话与产出全文检索

**产品行为**:一个全局搜索入口(cmdk 已在栈内),跨公司/项目搜会话内容、需求卡、产出文件名与 diff;点结果直达对应会话位置。

- 对标:Cursor 3.11 本地转录索引 + 全历史搜索(目前独有,跟进即差异化)。
- 实现锚点:SQLite FTS5,本地索引,不出网。
- 验收:live 场景——搜三天前某次会话里的函数名,3 秒内直达。

### W5 — best-of-N 比稿(差异化头牌,公司隐喻的原生表达)

**产品行为**:同一张需求卡可派给 2-4 名员工「比稿」,各自隔离 worktree 并行实现;审阅台并排比较各方案(diff 摘要 + 验证结果 + 成本),选中者合入,落选 worktree 自动清理;引擎网关落地后天然支持跨引擎比稿(Pi vs Codex 引擎同题竞技)。

- 对标:Cursor /best-of-n(独树一帜);Offisim 的公司隐喻(内部竞标、员工比稿)是它最自然的产品化外壳,别家做不了这个叙事。
- 依赖:W2 审阅台的比较视图;#55/#57 引擎网关合入。
- 验收:live 场景——一张卡派 3 名员工,并排审阅三方案,采纳其一,PR 建立,其余清理无残留。

### W6 — 员工记忆成长(差异化,连玩具化人设;后置)

**产品行为**:每名员工跨会话沉淀项目经验(踩过的坑、仓库偏好、惯用约定),下次同项目任务自动带上;员工档案页可见「资历」,可编辑可删除。对标 Claude Code auto-memory / Jules 仓库偏好 / Cursor Memories(正从差异化滑向标配)。W5 落地后再细化需求包。

### W7 — Skills 互通(小包,用户 2026-07-16 拍板追加)

**产品行为**:技能库与开放生态双向打通。**进口**——打开项目工作区自动发现 `.claude/skills/`、`.agents/skills/`、`.opencode/skills/` 目录,作为「项目技能」进技能清单,与公司/员工技能并列生效(叙事:员工进新项目自动学会项目规矩)。**出口**——员工的技能库技能对全部引擎生效:Pi 走既有 skillPaths,外部引擎(Codex/Claude Code)按各自的标准技能目录/参数带进会话,换引擎不丢技能。

- 地基:技能库已是 SKILL.md 开放标准(32+ 工具通用),格式零改造;确保 frontmatter 字段与标准无损对齐即可。
- 边界:不读全局 `~/.claude/skills/`(来源混淆);技能进 Market 作培训课程留远期,进出口跑通后再议。
- 依赖:出口的外部引擎侧依赖引擎纠偏(#57 重定向)落地;进口侧无依赖。
- 验收:live 场景——项目里放一个 Claude Code 格式技能,Pi 员工与 Codex 引擎员工各派一单,双方都按该技能行事。

## 3. 依赖与排期约束

- W1 等 #53/#54 合入;W2 等 #58 合入;W5 等 W2 + #55/#57。W3/W4 无在飞依赖,可与 W1/W2 并行开工。
- 每个 W 一张需求包 + 独立 PR train,延续现行五层质量漏斗 + live 闭环证据纪律。
- 全部为 prelaunch 增量:不写迁移、不留兼容层。
