# Offisim Codex 对齐盲测收敛 — Tasks

> 对应计划：[plan.md](./plan.md)
> 状态：IN PROGRESS，3/17 implemented；T05a 前置已交付，release 验收统一留在 T16
> 完成口径：真实行为 + 窄门禁 + full release + 精确 `.app`，仅文档、仅编译或 dev 预览均不算完成。

## 任务总表

| ID | 结果 | Blocked by | 状态 |
|---|---|---|---|
| T00 | 当前控制真源允许 engine-neutral Accounts / Models | — | [x] |
| T01 | 历史 approval 与 live run 分离 | T00 | [x] |
| T02 | 首次成功回复后的语义标题 | T00,T05a | [x] |
| T03 | 后端签发 effective task workspace | T00 | [ ] |
| T04 | 缺失 Project 目录自主恢复 | T03 | [ ] |
| T05 | 生产 engine gateway 与 API account | T00 | [ ] |
| T06 | Codex subscription 完整 engine | T05 | [ ] |
| T07 | Claude subscription 完整 engine | T05 | [ ] |
| T08 | AI Accounts / Models 设置整合 | T02,T05,T06,T07 | [ ] |
| T09 | Loops 自然语言主流程 | T00 | [ ] |
| T10 | Market 用户语言与空状态 | T00 | [ ] |
| T11 | Personnel Danger Zone | T00 | [ ] |
| T12 | Chrome、rails、nav、run pill 稳定 | T01 | [ ] |
| T13 | Usage / Cost 单一表达 | T08 | [ ] |
| T14 | Radius、presence、error 视觉语义 | T00 | [ ] |
| T15 | Dead docs 与 gates 收敛 | T01-T14 | [ ] |
| T16 | Release `.app` 盲测闭环 | T15 | [ ] |

## 全局执行规则

每个 task 开工前：

1. 确认真实当前时间；涉及模型、供应商、CLI、协议、依赖时查官方当前来源。
2. 修改 function / class / method 前运行 GitNexus upstream impact；HIGH/CRITICAL 先报告影响面。
3. 保存用户已有 dirty work，只触达本 task 与直接合同。
4. 先锁行为 oracle，再改实现；不得用按钮 no-op、fallback 或纯文案掩盖真值错误。

每个 task 完成前：

1. 跑该 task 的窄门禁并记录结果。
2. 更新 checkbox、acceptance 和 evidence。
3. 提交前运行 GitNexus `detect_changes(scope: compare, base_ref: main)`。
4. 运行 `git diff --check`。
5. release 交互统一在 T16 复验；任何 release finding 会重新打开对应 task。

---

## T00 — 当前控制真源

**结果：** 文档诚实区分当前 Pi 实现与 engine-neutral 产品目标，后续 Accounts / Models / subscription engine 不再被 dead rules 阻断。

### Acceptance

- [x] 当前实现仍明确是 `DesktopPiAgentRuntime`，没有把目标态写成 shipped。
- [x] 产品目标明确为单一 production gateway + 每 task 一个互斥完整 engine。
- [x] API 显示 Cost；subscription 显示官方 Usage。
- [x] Project、Conversation、Native Agent Home/Session/Memory、effective workspace 四层分离。
- [x] exact model id / source / checkedAt 与友好 UI 名称分层。
- [x] release、sandbox、prelaunch、Tauri-only 门禁未削弱。

### Evidence

- `AGENTS.md`、`CLAUDE.md`、`Docs/UI_FRAMEWORK_STACK.md` 与 current architecture indexes 已更新。
- 新真源：[`2026-07-13-engine-neutral-ai-accounts.md`](../../architecture/2026-07-13-engine-neutral-ai-accounts.md)。
- 当前控制文档旧冲突短语搜索为 0；`git diff --check` 通过。

---

## T01 — 历史 approval 与 live run 分离

**结果：** 重启后 stale/expired approval 仍可追溯，但不会生成幽灵 Stop、全局 running 或人员工作态；同一 Conversation 的新 Turn 独立执行。

### Acceptance

- [x] stale approval hydrate 后 phase 为 `interrupted`，approval 保持 dismiss-only。
- [x] global `activeRuns` 同时要求 controller ownership 与 active phase。
- [x] 同一 thread 可提交新 Turn；旧 interaction 先清理，不会 reattach/approve。
- [x] concurrent submit 仍原子拒绝，未引入重复 run race。
- [x] cleanup 失败进入现有 failed/retry 语义，不吞错误。
- [x] live Stop、Pi reattach、Office projection、scene cue、persistence 与删除合同无回归。

### Gates

- `pnpm harness:conversation-run-controller` — 25/25
- `pnpm harness:run-recovery` — 23/23
- `pnpm harness:office-projection` — 50/50
- `pnpm harness:scene-cue` — 87/87
- `pnpm harness:pi-agent-host` — PASS
- `pnpm harness:thread-lifecycle-guard` — 6/6
- `pnpm harness:chat-persistence` — 7/7
- `pnpm harness:conversation-deletion` — PASS
- `pnpm --filter @offisim/desktop-renderer typecheck` — PASS

### Release recheck

- T16 构造 approval → 退出 → 重启 → 确认无 Stop → 发送新 Turn → 运行真实 task → Stop。

---

## T02 — 首次成功回复后的语义标题

**结果：** Conversation 创建后立即有可读 fallback；首次成功回复后得到同语言的短语义标题；用户手动改名永不被覆盖。

### Scope

- 保留现有首条用户消息 fallback 与 markdown 清理。
- 成功持久化首条 assistant reply 后，使用当前 Turn 同一 engine/account 生成短标题。
- 标题 job 不调用工具、不切 provider；失败静默保留 fallback。
- 复用 `title_set_by_user` 作为锁，不新增第二套状态。

### Acceptance

- [x] 首条消息发送后立即出现 fallback，CJK/emoji 不截断。
- [x] 只有首次成功 assistant reply 才触发语义标题；failed/interrupted/approval 不触发。
- [x] 标题与对话语言一致，短、具体，不带“关于/讨论/帮助”等 AI 套话。
- [x] 手动改名在生成前、生成中、生成后都不被覆盖。
- [x] semantic job 重试幂等，刷新/重启不重复计费或反复改名。
- [x] job provenance 绑定当前 Turn 的 runtime/account/model/billing mode。

### Oracles

- 扩展 auto-title / conversation persistence harness。
- `pnpm harness:chat-persistence`
- `pnpm --filter @offisim/desktop-renderer typecheck`

### Evidence

- `pnpm harness:chat-persistence` — 13/13；并联 sqlite-proxy rename/claim 交错 50/50。
- `pnpm harness:execution-provenance` — 同 engine/account/model/billing、账户替换隔离、无 secret 泄露、terminal stream replay。
- `pnpm harness:prompt-enhance` — 62/62；isolated job 为 in-memory、no-tools、no workspace resources。
- `pnpm harness:conversation-run-controller` — 25/25；Stop/final-persist、approval、retry、route unmount 无回归。
- `pnpm typecheck`、`pnpm check:deadcode`、`git diff --check` — PASS。

---

## T03 — 后端签发 effective task workspace

**结果：** Project catalog folder 与每个 Turn 实际 cwd 明确分层；renderer、prompt 或历史文本都不能自报 canonical root。

### Scope

- 定义 canonical workspace binding：root、source、confidence、issuedAt、project/thread/turn scope。
- 由 Tauri/backend 验证与签发，继续受 `project_list_dir` / `project_read_file` sandbox 约束。
- 持久化最近成功 binding 与原因，供重启解释和 T04 恢复使用。

### Acceptance

- [ ] 每个文件型 Turn 都有后端签发的 canonical root。
- [ ] binding 与 project/thread/turn 匹配，不能跨 Project 或由 renderer 篡改。
- [ ] 文件工具只接受 binding scope 内路径。
- [ ] Conversation 历史、Native Session ref 与 workspace binding 可独立存在。
- [ ] 运行记录能解释实际目录、来源与置信度，不泄露 secret。

### Oracles

- 新增 task-workspace contract harness：正常、越界、伪造、重启、跨 Project。
- `pnpm harness:project-workspace`
- Rust command tests + renderer typecheck。

---

## T04 — 缺失 Project 目录自主恢复

**结果：** 用户删除原 Project folder 后继续发任务，Offisim 在唯一高置信候选中像 Codex 一样继续，并明确披露实际目录；不改 Projects catalog。

### Recovery order

1. 原 Project folder 仍存在：直接使用。
2. Conversation 最近成功 workspace 仍存在且身份一致：直接恢复。
3. 已知 workspace roots 中唯一名称 + repo identity 高置信匹配：自动采用。
4. 多个同置信候选：不猜、不写；仅在真正需要文件操作时明确阻塞。
5. 无候选：历史与纯对话仍可继续。

### Acceptance

- [ ] 原目录存在时不触发搜索。
- [ ] 自动恢复在首条进度中披露实际 cwd 与采用原因。
- [ ] multiple/none 情况绝不误写。
- [ ] 自动恢复不新增、删除或改写 Projects catalog。
- [ ] 重启后能解释上次 workspace binding。
- [ ] 非文件对话不因 folder 缺失被阻断。

### Oracles

- workspace harness：normal、deleted、renamed、unique、ambiguous、none。
- T16 使用临时目录副本完成破坏性 fixture，验收后清理。

---

## T05 — 生产 engine gateway 与 API account

**结果：** `DesktopAgentRuntime` 成为唯一生产 engine gateway；现有 API runtime 作为第一个中立 AI Account 完整工作。

### Scope

- **T05a（T02 前置）：** 由真实执行结果签发 Turn execution provenance，并提供锁定同一 engine/account/model 的 no-tools isolated text job；禁止 renderer 根据全局设置猜测。
- runtime session/tools/workspace capability 与 account execute/models/usage/cost capability 分层。
- 现有 live chat/Office 实际经过 gateway，不只做 schema/fixture。
- catalog 只接受 exact leaf id、source、checkedAt、availability。
- run/title job 持久化稳定 provenance。

### Acceptance

- [x] **T05a：** root run result 与持久化 context 都包含 engineId/accountId/billingMode/exact modelId/runId，值来自实际 host selection。
- [x] **T05a：** isolated text job 必须消费 source Turn provenance；engine/account/model 不匹配或 adapter fallback 时明确失败。
- [x] **T05a：** isolated job host-enforced no tools/no workspace/no transcript persistence，并返回实际 provenance 与 usage。
- [ ] API account 可完成真实 run、stream、tool、approval、Stop、recovery。
- [ ] 一个 task 只绑定一个 engine/account，不静默 fallback。
- [ ] token 分 input/output/cache/reasoning；缺失字段不伪造 0。
- [ ] Cost 标注 actual / estimate / unavailable。
- [ ] runtime/account/billing/model/usage provenance 可审计。
- [ ] Pi/provider implementation 名称不进入普通 UI。
- [ ] 旧 provider profile、sidecar 或双主路径不回流。

### Oracles

- 实施时按真实日期重查官方模型与费率。
- runtime conformance、agent-run projection、run-cost-scope、Pi host harness。
- 一条当前 release API live run 证据。

### T05a Evidence

- Pi 0.79.8 `ModelRegistry.isUsingOAuth(actualModel)` 是 billing 真值；OAuth 记 subscription，API key 记 api。
- Provider-native stable account id 优先；无 stable id 的 opaque credential 使用不可逆 generation fingerprint，宁可在轮换时拆分历史，也不把显式换号的 Usage/Cost 或 isolated job 合并。
- 成功 root、direct delegation 与 live reattach 缺 provenance 均 fail closed；abort 仍允许无 provenance。
- `SessionManager.inMemory` + discovery 全关闭 + 专用 temp cwd；Pi in-memory 写消息后无 session 文件。
- `pnpm harness:pi-agent-host`、Pi wire v7、Rust Pi host 27/27、run recovery 23/23 — PASS。

---

## T06 — Codex subscription 完整 engine

**结果：** 本机已登录 Codex 的用户无需 Offisim 二次登录，可选择 Codex 完成完整 task 并查看官方可证明的 Usage。

### Scope

- 只使用当前官方支持的 Codex 本机 protocol / app-server / CLI surface。
- Codex 作为互斥完整 engine，不作为 Pi 内 provider lane。
- 原始 auth、session、compaction、global memory 归 Codex Agent Home；Offisim 只存 opaque ref 与安全投影。

### Acceptance

- [ ] 自动发现本机 Codex 登录状态；未登录时给原生登录指引。
- [ ] 模型来自官方当前接口，保存 exact id、source、checkedAt。
- [ ] 完整执行 stream/tool/approval/Stop/recovery 与文件 workspace。
- [ ] Usage 使用官方 available 字段：used/remaining/reset/credits；缺失即 unavailable。
- [ ] 不读取、复制、展示或持久化 raw OAuth/token。
- [ ] Codex 不可用时不静默切 API、Claude 或 Pi。
- [ ] release `.app` 有真实 Codex task 证据。

### Oracles

- 固化 execution-date 官方协议 contract fixture。
- live Codex task + secret scan + runtime conformance。

---

## T07 — Claude subscription 完整 engine

**结果：** 本机已登录 Claude Code 的用户无需二次登录，可选择 Claude 完成完整 task；Usage 只按 Anthropic 官方可证明口径显示。

### Scope

- 使用当前官方 CLI / 本机 surface 发现账户与执行能力。
- Claude 作为互斥完整 engine，不经 Pi OAuth provider lane 冒充订阅。
- 原始 auth、session、compaction、global memory 归 Claude Agent Home。

### Acceptance

- [ ] 安全发现已登录状态，未登录时给原生指引。
- [ ] 完成 stream/tool/approval/Stop/recovery 与文件 workspace。
- [ ] 有官方 plan Usage 时显示真实 remaining/reset；没有时显示 unavailable。
- [ ] 第三方 harness extra usage 与 Claude subscription Usage 隔离。
- [ ] 不读取、复制、展示或持久化原始 auth secret。
- [ ] 不可用时不静默切换其他 engine。
- [ ] release `.app` 有真实 Claude task 证据。

### Oracles

- 实施时重查 Claude Code 官方 CLI / subscription 文档。
- live Claude task + secret scan + runtime conformance。

---

## T08 — AI Accounts / Models 设置整合

**结果：** Settings 按用户理解的 Accounts、Models、Usage / Cost 组织，不以 Pi Agent、OAuth source 或配置文件路径组织。

### Acceptance

- [ ] 本机订阅自动出现，无 Offisim 二次登录表单。
- [ ] API account 可配置 key，与 subscription 分组和计费口径不同。
- [ ] 模型 selector 以友好名称为主，exact id/source/checkedAt 在二级信息可见。
- [ ] 不支持的 capability 隐藏或中性表达，不制造红色假错误。
- [ ] 默认页面不出现 Pi Agent、`~/.pi`、`auth.json`、stored provider 等实现词。
- [ ] Cursor 等其他订阅只显示官方可证明能力；不抓私有本地状态。
- [ ] T02 标题 job 使用同一 Turn 的 account/engine，Usage/Cost 归属正确。

### Oracles

- settings coordinator、runtime capabilities、catalog freshness gates。
- T16 覆盖 API / Codex / Claude 三种账户状态和模型选择。

---

## T09 — Loops 自然语言主流程

**结果：** 用户通过自然语言创建、修改和运行 loop；graph 负责快速审阅，内部编译词下沉。

### Acceptance

- [ ] 空白状态首先邀请描述目标、重复条件和退出条件。
- [ ] 自然语言生成可读 graph；修改自然语言会更新 graph。
- [ ] graph 能快速识别步骤、分支、循环和退出。
- [ ] 主工具条无 Compile / IR / oracle / gate 等实现词。
- [ ] Advanced 仍能诊断真实编译/运行问题。
- [ ] 失败信息使用用户任务语言。
- [ ] loop runtime、repository、projection 无回归。

### Oracles

- loop-authoring-flow、loop-graph-projection、loop-repository harness。
- T16 创建、审阅、修改、运行一个真实 loop。

---

## T10 — Market 用户语言与稳定状态

**结果：** Market 围绕浏览、安装、已安装、导入、发布、审核组织；断网/未连接也保持稳定且可理解。

### Acceptance

- [ ] Browse / Installed 固定靠左，search 与右侧动作不因连接态跳位。
- [ ] 未连接远端时仍可搜索本地已安装内容，不留透明占位。
- [ ] 主流程不要求理解 registry/token/receipt/job id/package extension。
- [ ] endpoint/token 仅在有明确用途的 Advanced connection 设置出现。
- [ ] empty/loading/error/installed/update available 状态布局稳定。
- [ ] Import / Publish / Review 使用任务语言，底层包格式下沉。

### Oracles

- deterministic Market state fixture、UI drift/hygiene gate。
- T16 覆盖离线空状态、本地已安装、搜索、导入、发布入口。

---

## T11 — Personnel Danger Zone

**结果：** 日常编辑以 Save 为唯一主动作；Delete 完整保留但位于 overflow / Danger Zone。

### Acceptance

- [ ] 正常编辑视图 Save 是唯一主动作。
- [ ] Delete 可发现但不与 Save 同权重。
- [ ] 确认明确对象，取消无副作用，不增加多层权限戏剧。
- [ ] 删除后 selection、列表、Office projection 和历史引用正确。
- [ ] 保存、取消、删除均可键盘与辅助功能完成。

### Oracles

- employee save/delete、employee-version-on-save、Office projection harness。
- T16 使用临时员工覆盖保存、取消删除、确认删除。

---

## T12 — Chrome、rails、nav、run pill 稳定

**结果：** 顶栏和 Office 工具条在切换、折叠、run 状态变化时不抖动；不再靠内容区浮动按钮和补偿 padding。

### Acceptance

- [ ] 左右 rail toggle 只有一套，位于 Office top chrome，折叠后 rail 宽度为 0。
- [ ] 内容 header 无重复 toggle、mini rail、32/34px/pr-12 补偿死区。
- [ ] 六个 surface 始终有名称，active/inactive 尺寸与位置不变。
- [ ] 1024px 时优先压缩 ScopeBar，不隐藏 nav label。
- [ ] run pill idle/running/approval/completed/Stop 使用稳定槽位。
- [ ] compact run pill 仍显示阶段、确定性进度和 Stop。
- [ ] 没有真实 live run 时不显示 Stop 或幽灵占位。

### Oracles

- UI hygiene、UI drift、rail geometry gates。
- T16 在 1440×900 与 1024×700 覆盖四种 rail 组合和 run 状态。

---

## T13 — Usage / Cost 单一表达

**结果：** 同一 task/account/time window 只出现一套清楚读数；API 与 subscription 使用不同且真实的语义。

### Acceptance

- [ ] Office 默认视图不重复显示相同 token/cost。
- [ ] API 显示 token + actual/estimated/unavailable Cost。
- [ ] subscription 显示 provider-native Usage/reset/credits，不显示推算 Cost。
- [ ] 无 Usage capability 时隐藏或显示 unavailable，不显示 0%。
- [ ] account/task 切换后不串 Conversation、Project、月份或计费窗口。
- [ ] warning/critical 只来自真实 provider threshold 或用户明确预算。

### Oracles

- run-cost-scope 扩展 billing-mode/provenance fixture。
- activity-data、settings coordinator gates。
- T16 覆盖 API / Codex / Claude。

---

## T14 — Radius、presence、error 视觉语义

**结果：** 圆角、人员状态和错误卡片按角色稳定，不再靠临时数值与只依赖颜色/动画的表达。

### Acceptance

- [ ] radius roles 唯一映射：control、container、overlay、status、round。
- [ ] 已知 `2px/6px/7px/999px` 裸 radius 全部分类或移除。
- [ ] hygiene gate 能阻止任意新增非零裸 radius，不靠宽泛 allowlist。
- [ ] working/idle/offline/blocked/failed 在 reduced motion 下仍可辨。
- [ ] 状态至少由文字 + 色调/形状/表面中的一项共同表达。
- [ ] error banner 与 message column 共用水平 inset。
- [ ] Office dense HUD 与 dramaturgy 不被扁平化。

### Oracles

- UI hygiene、UI drift、office visual language gates。
- T16 覆盖 radius toolbar、五态 presence、error、reduced motion。

---

## T15 — Dead docs 与 gates 收敛

**结果：** current docs、agent instructions、产品行为与 gates 使用同一套已交付规则；旧 Pi-only/no-catalog 与错误 workspace/state 断言不再误导。

### Acceptance

- [ ] 逐份记录 retain / rewrite / supersede / delete 与替代真源。
- [ ] T00 的“目标态”按真实完成状态更新，未完成能力不提前写成 shipped。
- [ ] current docs 统一四层边界、engine-neutral、Cost/Usage、exact model truth。
- [ ] current docs 统一 Loops 自然语言、Market 用户语言、Office dramaturgy 保留。
- [ ] 旧 ADR/roadmap/prototype 要么删除，要么带 superseded banner 与当前链接。
- [ ] repo 搜索无互相冲突的现行 Pi-only/no-catalog/Settings exposes `~/.pi` 断言。
- [ ] gates 不再锁死 stale approval、实现词或旧产品语言。
- [ ] screenshots 作为历史证据保留，临时产物清理。

### Oracles

- dead-doc ledger、冲突词搜索、link checker。
- UI hygiene、runtime capabilities、catalog freshness、`pnpm validate`。

---

## T16 — Release `.app` 盲测闭环

**结果：** 当前 worktree release `.app` 在 fresh state 下连续两轮无本轮 finding。

### Full gates

- [ ] `node scripts/release-gates.mjs` 默认 `all` 通过，包含 Rust `cargo test --locked`。
- [ ] `pnpm --filter @offisim/desktop build` 通过。
- [ ] GitNexus detect_changes 影响范围与 T00-T15 一致。
- [ ] `git diff --check` 通过。

### Window identity

- [ ] 启动精确路径 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
- [ ] 操作前记录 windowId / CGWindowNumber、pid、title、bounds。
- [ ] 未使用 bundle id 启动、盲切焦点或 AppleScript 代替验收。

### Matrix

- [ ] stale approval / new Turn / live Stop。
- [ ] immediate fallback / semantic title / manual rename lock。
- [ ] normal / missing / unique / ambiguous task workspace。
- [ ] API / Codex / Claude account、model、真实 run、Usage / Cost。
- [ ] Loops 自然语言创建、修改、审阅、运行。
- [ ] Market、Personnel、chrome、rails、nav、run pill。
- [ ] radius、presence、error、Office projection 与 dramaturgy。
- [ ] 1440×900 与 1024×700。

### Closure

- [ ] fresh state 连续两轮零 finding。
- [ ] 每个新 finding 已回写所属 task、修根因、重建、重测。
- [ ] evidence 含 checkedAt、commit SHA、App SHA、窗口 identity、步骤、截图与 PASS/BLOCKER。
- [ ] transient profile、临时 workspace/员工、日志与无价值截图已清理。

---

## 收尾规则

T16 完成前，package 状态始终是 **未完整交付**。不得用“known limitation”、仅编译通过、部分 task 完成或 dev 预览替代最终验收。
