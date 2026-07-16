# Offisim Codex 对齐盲测收敛计划

> 状态：COMPLETE（17/17；T16 final release 已闭环）
> 最近核对：2026-07-17 NZST（+12:00）
> 合并 main 基线：`d33f5e6c`
> T16 盲测修复提交：`a88a7bd7`
> 执行清单：[tasks.md](./tasks.md)
> 架构真源：[Engine-neutral AI Accounts](../../architecture/2026-07-13-engine-neutral-ai-accounts.md)

## 1. Objective lock

把本轮真实盲测和 grill 结论完整落成产品行为：以 Codex 为体验标杆，收敛 UI/UX slop、AI slop、阻断性 bug 和理解困难；最终只认当前 worktree 的 release `.app`，fresh state 连续两轮无本轮 finding。

这不是单纯的视觉修补。本轮同时包含影响体验真值的运行状态、Conversation 标题、Project 与实际任务目录分层、AI Accounts / Models、API Cost 与外部 CLI 任务计量、Loops、Market、Personnel，以及互相冲突的 dead docs。

## 2. 已拍板的产品合同

1. **Project 是目录 catalog。** 创建 Project 必须绑定文件夹；Project 不承载 Conversation 历史、原生 agent session 或全局 memory。
2. **Conversation 独立存在。** Project 目录被删后，历史仍可读；新 Turn 可在唯一高置信目录继续，并披露实际工作目录，但不得暗改 Projects catalog。
3. **历史状态不等于 live run。** stale/expired approval 只能作为历史记录，不得制造全局 running、Stop 或占用人员工作态。
4. **标题两阶段生成。** 首条消息立即形成可读 fallback；首次成功回复后生成同语言的短语义标题；用户手动改名后永久锁定。
5. **API 与编排并存。** Pi host 承载玩家自配 provider/model 的 API 引擎；Codex/Claude Code 以外部 CLI 编排 adapter 接入。一个 run 只属于一个 lane，两类引擎不是替代关系。
6. **账户与计费分型。** API 账户显示 token 与 actual/estimated Cost；外部 CLI 任务只记引擎返回的 token 与时长，并标“订阅内 · 无 API 成本”。
7. **复用本机原生登录。** Offisim 不复制 OAuth/secret，不做二次登录；原生 session、compaction、global memory 仍归对应 Agent Home。
8. **模型真值按 lane 分层。** Pi API 模型来自用户 `models.json`，exact id 是执行值，用户 source 可选、官方 source/checkedAt 严格；外部 CLI 模型由 CLI 自管，不进 Offisim selector/catalog。
9. **Loops 自然语言优先。** graph 是快速审阅层；Compile、IR、oracle 等实现词只在 Advanced / diagnostics。
10. **Market 保留，基础设施词下沉。** 主流程说浏览、安装、导入、发布、审核，不让 registry/token/receipt/job id/package extension 占主界面。
11. **Personnel 删除保留但降权。** Save 是日常主动作，Delete 位于 overflow / Danger Zone。
12. **Office 演绎与 dense HUD 保留。** 本轮修几何、状态、语言和理解成本，不把产品扁平化成普通聊天壳。

## 3. 四层数据与责任边界

| 层 | 真值 | 可以持久化 | 不得承担 |
|---|---|---|---|
| Project | 用户登记的工作目录 | catalog metadata、folder binding | Conversation 历史、原生 auth、全局 memory |
| Offisim Conversation | 产品内对话与运行投影 | messages、turn/run projection、manual title lock | 原生 agent secret、凭 phase 猜 live run |
| Native Agent Home / Session / Memory | Codex、Claude、当前实现引擎 | 原生 auth、session、compaction、global memory | 被 Offisim 复制为第二套真源 |
| Effective task workspace | 当前 Turn 实际工作根 | 后端签发的 canonical binding、来源、置信度、时间 | 静默改写 Project catalog、renderer 自报 root |

## 4. Source truth

| 结论 | 当前事实 | 计划含义 |
|---|---|---|
| 当前生产 runtime | `DesktopAgentRuntimeGateway` 是唯一生产入口，已注册 Pi API engine、Codex CLI 与 Claude Code CLI 编排 adapter；三者并存且每 run 单 lane | T05/T06/T07 已交付；能力 manifest 决定可见控件，禁止伪装未声明能力 |
| Conversation 标题 | 已有首条消息 fallback 与 `title_set_by_user` 锁 | T02 复用现有合同，补首次成功回复后的语义标题 |
| stale approval | 旧投影可制造 active run | T01 从控制器真源修复，不在按钮层 no-op |
| Project workspace | T03 已交付后端签发、scope 防伪、内存 capability 与安全历史投影 | T04 只负责 Project folder 缺失后的高置信恢复与明确披露 |
| Settings | AI Accounts 同页分 API provider/model 编辑与外部 CLI 安装/登录/版本状态；Codex/Claude 不在 Offisim 重建账户用量与模型 catalog | T08 已交付；T07 已补齐 Claude CLI 真实状态卡与官方指引 |
| UI finding | 原始 15 张截图涵盖 radius、rails、cost、run pill、nav、Market、presence、error 等 | T12-T14 统一收敛并加入 deterministic gates |
| 最终验收 | 仓库明确只认 release `.app` + Computer Use | dev server、localhost、dev webview 仅用于排查 |

T05 API account 的模型、费率与 Usage 来源已按当时官方资料核对；T06/T08 在 2026-07-17 纠偏为用户 PATH 中的 Codex CLI/app-server 编排，不再维护 Codex 模型与账户 Usage 来源。T07 同日按 Claude Code 官方 CLI 文档与本机协议实测落为 `claude -p` + `stream-json` 编排，同样不维护模型与账户 Usage 来源。

## 5. 执行 Waves

### Wave A — 真值与阻断 bug

- T00：解除旧 Pi-only / no-catalog 控制文档冲突。
- T01：历史 approval 与真实 live run 分离。

### Wave B — 执行 provenance、Conversation 与 workspace

- T05a：先冻结 Turn execution provenance 与同 engine 的 isolated text job；这是 T02 的真实性前置，不等同于 T05 全部完成。
- T02：即时 fallback + 首次成功回复语义标题 + manual lock。
- T03：后端签发 effective task workspace。
- T04：Project folder 缺失时的高置信恢复与披露。

### Wave C — Engines、Accounts、Models

- T05：生产 engine gateway 与 API account 纵切。
- T06：Codex CLI 编排适配器。
- T07：Claude Code CLI 编排适配器。
- T08：AI Accounts / Models 设置整合。

### Wave D — 产品主流程与视觉语义

- T09：Loops 自然语言主流程。
- T10：Market 用户语言与稳定状态。
- T11：Personnel Danger Zone。
- T12：chrome、rails、nav、run pill。
- T13：Usage / Cost 单一表达。
- T14：radius、presence、error。

### Wave E — 清理与真实交付

- T15：dead docs、旧断言与 gates 收敛。
- T16：完整 release gates、精确 `.app`、fresh state 两轮盲测、产物清理。

## 6. 依赖与并行边界

- T00 是所有产品方向任务的控制真源前置。
- T03、T05a、T09、T10、T11、T14 在 T00 后可独立推进。
- T02 依赖 T05a，禁止在 provenance 不可证明时用全局默认模型伪装“同一 Turn engine/account”。
- T04 依赖 T03；T06、T07 依赖 T05；T08 依赖 T02、T05、T06，并只整合已交付 engine；T07 以后按相同账户合同扩展；T13 依赖 T08。
- T12 依赖 T01，避免 UI 再消费幽灵 live run。
- T15 分开记录“代码已实现”与“release `.app` 已实机证明”；T07 已用精确 worktree release `.app` 完成真实 Claude task、工具事件、Token/时长与 Stop 证明。
- T16 是唯一 package 完成门；任何未闭环 finding 都回到所属 task。

## 7. 反过度工程边界

- 不恢复平行 provider lane；Pi API 与外部 CLI 编排都从唯一 gateway 接入，每个 run 只走一个 lane。
- 不复制 Codex/Claude 原始凭证、session 或 memory，不抓私有文件重建模型 catalog、账户健康或订阅 Usage。
- 不为未上线本地状态增加 migration、compat、fallback 或 rollout。
- 不让 renderer 自己决定 canonical workspace；签发与 sandbox 在后端。
- 不搭新视觉 package，不增加 Web 产品，不用外圈 padding 制造层级。
- 不用宽泛 allowlist 让 hygiene gate 假绿；协议值只能精确、带理由豁免。

## 8. 完成定义

只有以下全部成立，计划才能标记 COMPLETE：

1. [tasks.md](./tasks.md) 的 T00-T16 和 acceptance 全部完成。
2. `cargo test` 与 `node scripts/release-gates.mjs --lane=node` 分 lane 通过；Node lane 不准备或调用 Cargo。
3. `pnpm --filter @offisim/desktop build` 通过。
4. 启动当前 worktree 精确路径的 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
5. Computer Use 先记录 windowId / pid / title / bounds，再覆盖完整验收矩阵。
6. fresh HOME 完整轮、第二 fresh HOME 抽查和 finding 修复后的精确回归均无未闭环问题。
7. evidence 记录 checkedAt、commit SHA、App SHA、窗口 identity、步骤、截图和 PASS/BLOCKER。
8. 临时 profile、测试工程副本、无价值日志/截图清理完成。
