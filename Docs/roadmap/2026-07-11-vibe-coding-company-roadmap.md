# Vibe Coding 公司模版与生产力 Roadmap

日期:2026-07-11(行业资料按当日核对)。状态:已拍板,待分 phase 执行。

## 0. 背景与拍板

痛点:用户在 Claude Code 用 Fable 5 做规划后,只能靠 bash 调 Codex CLI(gpt-5.6-sol)执行,编排割裂、不可见、不可干预。Offisim 要把「贵模型规划 + 便宜模型执行」做成产品原生能力,且不止演绎丰富,要真好用。

已拍板决策(用户确认,2026-07-11):

1. **模型生态**:按真实多 provider 设计——用户会往 Pi `~/.pi/agent/models.json` 配多家 key(Anthropic/OpenAI/GLM 等)。遵守 AI Runtime Policy:Offisim 不建模型 catalog,模型选项永远只读 Pi models.json。
2. **编排交互**:任务板可见 + 默认自动跑。planner 的计划实时落到可见任务板,executor 自动认领执行,用户可随时暂停/改派/插单;不设强制审批关卡。
3. **Loops 含义**:迭代循环直到验证过(ralph-loop 风格),作为 executor 的默认工作方式。
4. **北极星**:替代用户日常 vibe coding 主力——git/diff review/门禁/PR 闭环都要有,dogfood 到天天用。

## 1. 行业基线(2026-07 标配,缺了就不好用)

来源:2026-07-11 实查 Claude Code / Codex CLI / Cursor / opencode / Amp / Devin / Factory Droids 等当前资料。

关键事实:
- **per-agent 模型分层已是四家原生能力**(Claude Code subagent frontmatter `model:`、Codex multi-agent v2 per-thread 路由、Cursor Plan/执行分模型、opencode per-agent model)。planner/executor 拆分实测总成本省 80-85%,贵模型只产 10-20% token。
- **loop 已官方产品化**:Codex `/goal`(目标循环+token 预算)、Claude Code grader loop(评分打回重做)与 `/loop`(定时,最长 3 天)。心法:以门禁绿为唯一完成判据。
- **任务板 + worktree 隔离 + plan mode + 后台并行全标配**;Devin Desktop 直接是 agent Kanban 指挥中心,第三方层(Vibe Kanban/Conductor)把「每任务一个 worktree」当默认架构。
- **「公司/团队」隐喻被市场验证**:Factory Droids($1.5B 估值)、Devin Desktop、Claude Code Agent Teams。supervisor 模式(单一可问责编排者 + 并行 worker)是主流形态——Offisim 的办公室隐喻方向正确,差的是真实工程闭环。
- 典型工作流已固化:计划(人只审计划)→ 派活(kanban 卡,每卡一个 worktree agent,3-6 并行)→ agent 自跑 loop 到门禁绿 → 人在 diff 层 review → 出 PR。

### 覆盖对照(标配 Top 10 × Offisim 现状)

| # | 2026-07 标配 | Offisim 现状 | 缺口 |
|---|---|---|---|
| 1 | subagent + 每 agent 独立模型 | delegate 有(depth 2/并行 4/总 16),但员工无 model 字段,child 恒继承 root 模型 | **致命缺口** |
| 2 | plan mode / 计划审批 | plan 权限档有,无「计划→放行→执行」闭环 | 中(已拍板不做强审批,做任务板可干预) |
| 3 | 后台并行 agents | 有(parallel delegation + usage 聚合 + run-tree) | ✅ |
| 4 | git worktree 每任务隔离 | 有(lease-manager + isolated worktree),但 single-mode write 有孤儿 bug(见 P0) | 修 bug 即达标 |
| 5 | 目标循环(loop until green) | mission loop 有(attempt 上限/failure signature/预算闸);普通 delegate task 无 | 中 |
| 6 | 任务板/队列 | Task Board 有,lease review 状态不区分「运行中/待合并」 | 中 |
| 7 | diff review + 回传 agent | git 工作台只读(status/diff 展示),无用户侧 review/merge UI | 大 |
| 8 | 一键 PR / ticket 集成 | 无(git.rs 白名单无 gh) | 大 |
| 9 | agent 定义文件化 | 员工 persona 有;skills 只展示不注入 Pi 运行时 | 中 |
| 10 | token/成本预算控制 | 全树 token backstop 有;无按员工/模型分账,无分层路由策略 | 中 |

## 2. Roadmap

### P0 — 地基修复(先于一切新功能)

审计确认的真缺陷,其中 ① 直接打脸编排故事:

1. **delegate 单任务 write worktree 孤儿**(P1,`scripts/pi-child-supervisor.mjs:611` + `pi-delegation-extension.mjs:113-116`):single 模式(默认模式)的 write 任务,child 在隔离 worktree 提交后,integration 只在 `runParallel` 路径触发——单任务的成果永远留在 `.offisim/worktrees/<uuid>`,agent 报「done」但项目文件根本没变,任务板也无法区分。修法:runSingle 后同样跑 integration,或返回摘要注入「未合并」标记 + lease 状态补 `retained_for_review`。
2. **SQL capability 旁路**(P0 防御纵深,已亲验:`capabilities/default.json:9-10`):`sql:allow-execute`/`sql:allow-select` 把原生 plugin-sql 命令直接开给主窗口,自建的 `validate_statement_sql` 白名单(防 XSS/deep-link 任意 SQL)只护 `local_db_execute_transaction` 一扇门,而 `tauri-drizzle.ts:113,124` 的日常读写全走未设防的原生路径。修法:全部 SQL 收口到单一 Rust 命令做白名单,或在 `getTauriDb()` 包装层统一校验。
3. **sidecar/MCP stdout 无界缓冲**(P1,`mcp_bridge/jsonrpc_framer.rs:9-28`、`pi_agent_host/run.rs:42-46,109`):恶意/失控 MCP server 一行超长输出可 OOM 整个桌面进程;git lane 已有 `read_capped`(1MB)范式,照抄。
4. **协议版本第三 literal 无门禁**(P2,`reconcile-interrupted-runs.ts:73`):`check-pi-wire-contract.mjs` 只对 Rust/Node,TS 副本可静默失同步。纳入门禁。
5. **文档 drift**(P2):根 CLAUDE.md 的「Desktop Credential Isolation」必须以 `local_secret.rs` 的应用密钥封装边界和 Pi 自管 `~/.pi/agent/auth.json` 为当前事实。

### P1 — 员工-模型绑定(核心解锁,模版的前置)

- `employees` 加 `model`(可选 `thinking_level`)列;`DelegationRosterEntry` 投影带字段。执行层已半就绪:`pi-child-supervisor.mjs:412` 已在读 `employee.model`,堵点只在数据模型和 roster 投影。
- 员工卡 + 创建向导的模型下拉,选项 = Pi models.json(`pi_agent_status.availableModels`)。
- child 会话用员工绑定的 model/thinkingLevel;delegate 不需要 per-task model 参数(模型属于员工,不属于任务——直观即卖点)。
- 成本按员工/模型分账展示(现 `run-cost.ts` 只出总额)。
- 验收:同一次委派,root 与各 child 用各自绑定模型,usage 分账在 UI 可见。

### P2 — 「Vibe Coding Studio」内置公司模版

- 第 6 个内置模版(`packages/core/src/templates/index.ts`):**Orchestrator**(贵模型,只做 plan/review/合入决策)+ 2-4 **Executor**(便宜模型,implement)+ **Reviewer**(中档,diff review)。角色分工写进 persona + DELEGATION_FLOW_GUIDANCE。
- 创建向导一屏配完:每个员工的模型下拉 + 绑定真实项目 workspace。
- 未配多模型时的体验兜底:提示去 Pi models.json 配,而非静默同模型。

### P3 — 任务板编排闭环(可见 + 可干预)

- planner 计划实时落任务板;默认自动执行;用户可暂停/改派/插单。
- lease review 状态机修全(active/retained_for_review/released),Merge/Discard 用户侧真闭环。
- diff review UI:在现有只读 git 工作台上升级出「按任务看 diff → 批注 → 回传 agent 返工 / 合并」。

### P4 — 迭代循环 loop-until-green

> 交付状态（2026-07-12）：代码与确定性门禁已完成；release `.app` 真实交互验收留给上游主环境。

- executor 默认工作方式:改 → 跑验证 → 再改,验证判据 = 项目门禁命令(typecheck/test/validate,项目级可配)。
- 复用/泛化 `MissionLoopController`(attempt 上限、failure signature 去重、token 预算闸全都现成)到普通 delegate task,不再限于 mission 通道。
- 预算闸与成本分账联动(P1 的分账数据)。
- 项目配置真相源为 `projects.verify_command / verify_max_attempts / verify_token_budget`；空命令保持单轮。
- write child 在自己的 lease worktree 里经 Rust `bash_execute` 沙箱真跑门禁；只有 exit code 0 才进入 `pending_review`。
- 循环进度与终止原因复用 `workspace.lease.snapshot` → `agent_events` 投影，不新增事件存储。

### P5 — 日常主力闭环(git/PR)

- 用户侧 commit/branch/push 操作(git.rs 白名单已含 commit/branch,补 push 的 ask 级门)。
- PR 创建与管理(gh 进白名单,ask 级门)。
- 验收 = dogfood:用户真实项目一整天的 vibe coding 全在 Offisim 完成。

### P6 — 好用性补齐

- skills 注入 Pi 运行时(盘点确认:公司 skills 现在只展示 + loop 绑定,无注入 wire payload 的证据——补齐后员工能力清单才是真的)。
- Loops 域接 scheduler(定时/触发,补上 skill asset 里预留的 harness native trigger)。
- 成本预算告警可视化;child 权限档继承会话设置(现恒 auto)。

## 3. 审计结论摘要(2026-07-11,三路分区)

- **runtime 核心**(Pi host/wire/delegation):质量高。历史 projectId 地雷已闭环且有门禁;唯一实质缺陷即 P0-① worktree 孤儿。
- **renderer**:零达标 findings,re-render/GPU 泄漏/stale closure 各风险路径都有显式防御,评价「production-grade」。代码分割已做足(SurfaceRouter 全懒加载)。
- **Rust + 工程门禁**:沙箱/凭据/DB 严谨且有对抗性测试;实质缺陷即 P0-②③。门禁脚本无「单侧为空跳过」假阴性;validate ⊂ release-gates 结构无新坑(本地预检跑 `node scripts/release-gates.mjs --lane=node` 的既有纪律不变)。
