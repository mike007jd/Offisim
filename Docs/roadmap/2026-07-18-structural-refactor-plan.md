# 结构性 Refactor 执行包(2026-07-18)

> **历史完成计划（2026-07-22 复核）**：A/D 系列结构重构与独立审计已经
> 落地并收官。本文保留原执行约束和审计背景，不得当作当前分支/PR 指令重跑。

基线:main `49cd38e1`。本文档是完整 handoff:执行方(Codex)按此逐 PR 交付;
Fable 额度恢复后将按本文档逐行审计每个 PR。审计基准就是本文档的
「验收」与「铁律」小节——偏离即返工。

审计来源:2026-07-18 四区并行扫描(Rust src-tauri / renderer runtime /
UI surfaces / packages+scripts),结论已核对到行号。

---

## 0. 全局铁律(每个 PR 都适用)

1. **纯机械重构**:移动代码、消重、换调用点。禁止顺手改行为、改文案、
   改契约、"优化"逻辑。行为变更 = 返工。
2. **一 PR 一主题**,按本文档编号命名分支 `refactor/<PR-ID>-<slug>`。
   禁止跨 PR 混装。
3. 每个 PR 必须通过:`node scripts/release-gates.mjs --lane=node` +
   (touch Rust 时)`node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked`。
   UI/runtime PR 另需 release `.app` live 冒烟(路径铁律见 CLAUDE.md)。
4. **安全边界代码**(git allowlist validators、env 脱敏白名单、
   builtin_tools sandbox 上限、task_workspace_binding 授权)只许搬家,
   不许改判定;涉及白名单合并一律取**并集**并保留双侧现有测试。
5. 禁止新增本文档未列出的抽象层。发现计划与仓库现状冲突时,停下记录到
   PR 描述,不要自行发明方案。
6. Prelaunch 铁律照旧:不写 migration/兼容层(见根 CLAUDE.md)。
7. merge 一律等用户批准;PR 之间的依赖顺序见 §2 总表。

已亲写的锚点代码(直接用,不要重写):
- `scripts/lib/harness-runner.mjs` — 共享 harness 骨架,已自测通过。
  API:`createHarness(title)` → `{ check, checkAsync, section, report }` +
  `deepFreeze` + `repoRoot`。输出格式与旧骨架逐字节兼容。
- `apps/desktop/src-tauri/src/process_group.rs` — 进程组公共模块
  (configure/signal/Guard/terminate,语义 = git.rs 原版)。**尚未注册**:
  PR-A3 第一步在 `lib.rs` 加 `mod process_group;` 并编译。

---

## 1. PR 总表(顺序 = 依赖)

| PR | 主题 | 规模 | 风险 | 依赖 |
|----|------|------|------|------|
| A1 | harness-runner 试点迁移(10 个)+ manifest 化 validate | 中 | 低 | — |
| A2 | 其余 ~107 个 harness 迁移 | 大(机械) | 低 | A1 |
| A3 | Rust 去重:process_group 落地 ×4 + time_util + env_scrub | 中 | 低 | — |
| A4 | renderer relativeTime 统一 + 手写空态迁 EmptyState | 小 | 低 | — |
| B1 | desktop-agent-runtime:纯函数模块搬出 | 中 | 中 | — |
| B2 | desktop-agent-runtime:事件分发统一(核心) | 大 | 高 | B1 |
| B3 | desktop-agent-runtime:持久化层搬出 | 中 | 中 | B2 |
| C1 | agent-host stream 层:先统一测试,再抽 RunStreamCore | 大 | 高 | — |
| C2 | agent-host 命令宏 + CLI 探测合并 | 中 | 低 | C1 |
| D1 | git.rs → git/ 五模块机械拆分 | 大(机械) | 中 | A3 |
| D2 | task_workspace_binding → binding/ 四模块 | 大(机械) | 高 | D1 |
| D3 | builtin_tools → builtin/ 三模块 | 中 | 中 | A3 |
| U1 | query-key factory + 122 处失效收敛 | 中 | 低 | — |
| U2 | UI 大文件拆分(5 个) | 大(机械) | 低 | — |
| U3 | 共享 Card/ListRow/内联 Dialog 抽出 | 中 | 低 | U2 |
| U4 | OfficeScene2D 绘制管线 + EmployeeUnit 拖拽 hook | 大 | 中 | — |
| U5 | 三个 *-data.ts 移出 surfaces/ 到 @/data | 中 | 低 | U1 |
| S1 | shared-types 拆 @offisim/dramaturgy + packages/renderer 改名 @offisim/prefab | 大 | 中 | — |
| S2 | repositories.ts 按域拆 re-export | 中(机械) | 极低 | — |

并行车道:A 系可先行;B 系、C 系、D 系、U 系、S 系互不阻塞,可各开一条
worktree lane。**同一系内严格按序**。

---

## 2. 各 PR 规格

### PR-A1 harness-runner 试点 + validate manifest 化
- 迁移 10 个代表性 harness(同步/异步/loader 注入各覆盖)到
  `scripts/lib/harness-runner.mjs`:删本地 `check`/计数器/deepFreeze/
  root 解析,结尾改 `h.report()`。迁移前后 log 输出必须逐字节一致
  (可 diff 验证)。
- 新建 `scripts/harness-manifest.mjs`:导出数组
  `{ id, file, runner: 'node'|'tsx', tsconfig?, nodeOptions?, cwdFilter? }`,
  收录 package.json 全部 `harness:*` 条目(100 条),含
  `harness-chat-persistence` 的 loader 注入等特例。
- 新建 `scripts/run-harnesses.mjs`:遍历 manifest 串行执行、汇总失败;
  `pnpm validate` 巨链替换为
  `pnpm typecheck && ... && node scripts/run-harnesses.mjs`(非 harness 的
  check:* 段保持原样)。保留 `harness:*` 单条脚本入口(改为
  `node scripts/run-harnesses.mjs --only <id>`)。
- 验收:`node scripts/release-gates.mjs --lane=node` 全绿;单跑
  `--only` 任一 id 行为与旧命令一致;故意注入一个失败能让 validate 红。
- 注意:`scripts/check-cross-package-src-imports.mjs` 内联引用了 83 个
  harness 路径,manifest 化后同步其读取来源(读 manifest,不再硬编码)。

### PR-A2 全量 harness 迁移
- 其余 harness 全部迁到 runner;逐文件 diff 迁移前后输出。禁止趁机改断言。
- 预期净删数千行。验收同 A1。

### PR-A3 Rust 去重
1. `lib.rs` 注册 `mod process_group;`。四处替换为公共模块:
   - `git.rs:1855-1908`(grace=500ms)
   - `builtin_tools.rs:2350-2787`(保留其 `signal_*_with` 变体所需的
     调用点参数;stdout capping 不动)
   - `pi_agent_host/run.rs:230-294`
   - `codex_agent_host/protocol.rs:1309-1328`
   各处删除本地副本,行为参数(grace、信号序列)以原实现为准显式传入。
2. 新建 `time_util.rs`:canonical `civil_from_days`(以 `preview.rs:103`
   为准)+ `now_unix_ms`(canonical 返回 `i64`,调用点自行转换)+
   `rfc3339_from_unix` + `stable_hex`。替换:`preview.rs:103` /
   `git.rs:4146` / `codex_agent_host/manager.rs:2035`(注意它是 i64 签名,
   在调用点适配)/ `browser_session.rs:577` / `startup_safety.rs:403` /
   `app_update.rs:477` / `task_workspace_binding.rs:1180`。
3. 新建 `env_scrub.rs`:合并 `scrubbed_shell_env`(builtin_tools.rs:1587)
   与 `scrubbed_git_env`(git.rs:2149)。**白名单取并集**,保留
   `git.rs:8175` `scrubbed_git_env_excludes_provider_secrets` 测试并为
   shell 侧补对称测试。
- 验收:`cargo test --locked` 全绿;git/shell/pi/codex 四条 Stop/终止
  路径在 release `.app` 各冒烟一次(起任务→停止,无僵尸进程)。

### PR-A4 relativeTime 统一 + 空态收敛
- 统一到 `@/lib/utils` 的 `relativeTime`,删除:`office/RecoveryPanel.tsx:13`、
  `mission/loops/LoopLibrary.tsx:60`、`mission/loops/LoopRuns.tsx:17`、
  `office/board/activity-data.ts:962`(签名不同的在调用点适配)。
- 手写空态字符串迁 `shared/SurfaceStates.tsx` 的 `EmptyState`:
  AiAccountsPane(759、1020)、McpServerDetailPane(360)、TeamDock(298)。
  ConnectRail 763/901 逐字重复文案提常量(组件合并留给 U2)。
- 验收:renderer typecheck+build;涉及面 live 截图对比无视觉回归。

### PR-B1 desktop-agent-runtime 纯函数搬出(不改行为)
从 `runtime/desktop-agent-runtime.ts` 机械搬出(保持 export 与调用不变,
新模块放 `runtime/` 下):
- `runtime/execution-selection.ts`:`resolveRuntimeExecutionSelection`
  (949-1051)、`resolveApiExecutionSelection`(1052-1118)、
  `orchestrationExecutionTarget`/`readyOrchestrationEngine`/
  `isCanonicalOrchestrationTarget`(923-948)、`availableApiModel`/
  `hostModelRef`(871-922)。
- `runtime/host-event-factories.ts`:606-800 的事件工厂/payload 解析群。
- `runtime/workspace-binding.ts`:1202-1324。
- `runtime/run-context.ts`:1325-1586。
- 验收:typecheck+build;`harness-agent-run-projection` 等相关 harness 绿;
  git diff 里新模块内容与删除内容可逐行对上(纯移动)。

### PR-B2 事件分发统一(本次 refactor 核心,唯一允许结构重排的 PR)
目标:`runNativeTurn`(3310-4287)、`reattachLiveRuns`(2616-3310)、
`consumeSharedHostEvent`(1910-2296)三处 `event.kind` 分发合并为一张
handler 表。目标架构(Fable 拍板,按此实现):

```ts
// runtime/host-event-dispatch.ts
export interface HostEventContext {
  mode: 'live' | 'reattach' | 'shared';
  runId: string;
  threadId: string;
  // 注入点:persist* 回调、snapshot 更新、控制队列 settle、
  // 事件总线 emit —— 全部以接口传入,handler 内不 import runtime 类
}
export type HostEventHandler<K extends PiAgentHostEvent['kind']> = (
  event: Extract<PiAgentHostEvent, { kind: K }>,
  ctx: HostEventContext,
) => Promise<void> | void;
export const HOST_EVENT_HANDLERS: {
  [K in PiAgentHostEvent['kind']]?: HostEventHandler<K>
};
export async function dispatchHostEvent(e: PiAgentHostEvent, ctx: HostEventContext);
```

- live 与 reattach 的差异(如 `workspaceBound`/`workspaceUnavailable` 仅
  reattach 有)通过 `ctx.mode` 分支进 handler 内部,**不是**三张表。
- 迁移策略:先把三处现有分支逐字搬进 handler(允许 handler 内部暂存
  `if (ctx.mode === ...)`),对齐后再消内部重复。两步可以是同一 PR 的
  两个 commit,方便逐行审计。
- 验收:typecheck+build + 全 harness;release `.app` live 必测四场景:
  正常跑单、跑单中途 app 重启后 reattach 续流、approval 弹条、Stop。
  这是全 refactor 唯一必须完整 live 回归的 PR。

### PR-B3 持久化搬出
- `runtime/agent-run-persistence.ts`:7 个 persist* 方法(4287-4812)
  迁到已有 `AgentRunPersistenceQueue` 承接;runtime 类只留调用。
- 验收:typecheck+build+harness;live 跑单后重启,历史记录完整。

### PR-C1 agent-host stream 公共层
- **第一步(独立 commit):测试先行。** 把 codex `stream.rs:635-820` 与
  pi `tests.rs:1834-2311` 的流竞态测试整理为同一组语义用例
  (publish/subscribe/replay cursor/terminal/bounded-pending),两套实现
  各自跑绿,锁定现状语义差异并记录在 PR 描述。
- 第二步:抽 `agent_host_stream.rs`(或扩展 `agent_host_runtime.rs`):
  `RunStreamCore<E>` 泛型承载 buffer/replay/subscriber/terminal 判定
  (terminal 判定用 trait 注入);pi 与 codex 各自适配。claude 已复用
  pi 侧,随 pi 迁移。**语义以 pi 侧为准**(bounded-pending fail-closed),
  codex 若有差异按测试锁定的现状保留、在类型上显式化。
- 验收:cargo test 全绿(含第一步新增用例);三引擎 live 各跑一单 +
  中断重连。

### PR-C2 命令宏 + CLI 探测合并
- 声明宏 `agent_host_commands!` 生成 codex/claude 的 `*_impl` 委派体
  (commands.rs 各 79 行);**命令名必须逐字不变**
  (`permissions/agent-bridges.toml` capability 按名绑定,变名即破坏)。
- CLI 探测(codex `manager.rs:1654-2025` 与 claude 对应段)合并进
  `agent_host_runtime.rs` 已有的 node 二进制发现旁。
- 验收:cargo test;Settings 页三引擎 install/login/version 状态 live 正常。

### PR-D1 git.rs 机械拆分
拆 `git/` 子模块,纯移动:`exec.rs`(capped 执行,1908-2166)、
`allowlist.rs`(43 个 validate_*/is_allowed,753-2763 内散布)、
`worktree.rs`(2243-3145)、`lease.rs`(lease 生命周期+持久化,
53-123/601-687/1142-1236/3434-4125)、`checkpoint.rs`(705-748/1236-1855)。
`git.rs` 保留命令入口与 re-export。现有测试(7xxx-8xxx)随对应模块走。
- 验收:cargo test;live:git 面板 status/commit/push、checkpoint 创建
  回滚各一次。

### PR-D2 task_workspace_binding 机械拆分
`binding/resume_compat.rs`(1297-2467,先拆这块最独立的)→
`binding/registry.rs`(760-1169)→ `binding/persistence.rs`(2807-4095)
→ `binding/project_crud.rs`(4095-4591)。授权中枢,**只许纯移动**,
tests(4591+)先行随迁。
- 验收:cargo test;live:三引擎各起一单验证 workspace 授权、resume 一次。

### PR-D3 builtin_tools 机械拆分
`builtin/sandbox_path.rs`(349-846、1107-1407;与 local_paths.rs 重叠函数
只搬不合,合并另立后续单)、`builtin/shell.rs`(1953-3060)、
`builtin/proc_probe.rs`(2477-2683 平台 cfg 三分叉集中)。
- 验收:cargo test;live:agent 读写文件 + bash 各一次,越界路径拒绝仍生效。

### PR-U1 query-key factory
- 新建 `data/query-keys.ts`:`queryKeys.threads(projectId)` 等,覆盖
  data/queries.ts 全部 27 hook 的 key + 跨文件硬编码点
  (`office-layout` 在 market-data.ts、TemplatePreview.tsx)。
- 122 处 `invalidateQueries`/`setQueryData` 全部改经 factory;按实体加
  聚合失效 helper(如 `invalidateThreadScope(qc, projectId)`)。
- 验收:typecheck+build;全仓 grep 不再有内联 `queryKey: ['...` 字面量;
  live:删会话/删公司后列表刷新正常(原 6-7 连 invalidate 场景)。

### PR-U2 UI 大文件拆分(纯移动)
- WorkspacePanel → `workspace-panel/{FilesTab,FileContextMenu,ProjectsTab,GitTab}.tsx`
- StageViewer → `stage-viewer/{StageTopBar,StageViewMenu,StageAutoOpen,views/*}.tsx`
- BoardStage → `board/{BoardCard,BoardDrawer,BoardTimeline}.tsx`
- PersonnelSurface → 拆出 `HireEmployeeDialog.tsx`、`EmployeeDetail.tsx`
- ConnectRail → 拆出 `ThreadRow/MessageRow/Composer`;两套 ThreadDetail
  合并为 `ThreadDetailShell`(唯一允许的结构变更,重复文案见 A4)
- 验收:typecheck+build;五个面 live 截图对比零视觉变化。

### PR-U3 共享原语
- `components/`(renderer 内,遵守「不建共享 UI 包」铁律)新增
  `SelectableCard` 基座与 `ListRow`(avatar/title/subtitle/meta/selected);
  9 处卡片、Roster/Thread/Message 三套行迁移。内联 Dialog 已在 U2 拆文件,
  这里统一到共享 Dialog 原语。
- 验收:typecheck+build;live 截图对比(允许 ≤2px 间距级差异,超出返工)。

### PR-U4 场景层
- OfficeScene2D 的 draw 闭包(useEffect 内 ~680 行)拆
  `scene/render2d/{background,zones,employees,flows,companion,shelf}.ts`
  纯函数管线,effect 只留 rAF 调度。
- OfficeScene3D `EmployeeUnit`(376-1000)拖拽状态机(671-760)提
  `useEmployeeDrag`;flow-packet 系列组件拆独立文件。
- chip-tone 表、`activeFlowTargets` 派生、flow-lane 几何三处 2D/3D 平行
  实现提到共享 projection 模块(色值仍各自保留 2D hex / 3D INK)。
- 验收:typecheck+build;live:2D/3D 切换、拖拽落位、跑单时 flow 动画,
  录屏对比。

### PR-U5 data 层归位
- `market-data.ts` 拆三块迁 `@/data/market/{types,registry-client,queries}.ts`;
  `task-board-data.ts`、`activity-data.ts` 迁 `@/data/board/`,展示映射
  (icon/level/相对时间)留 surfaces 侧 `*-presentation.ts`。key 全部走
  U1 factory。
- 验收:typecheck+build;Market 安装/发布、Board、Activity 各 live 一遍。

### PR-S1 拆包与改名
- 新建 `packages/dramaturgy`(`@offisim/dramaturgy`):shared-types 中
  dramaturgy/ 的运行时逻辑(composeBeats/ambient/staging/performance/
  modes)整体迁入;shared-types 保留纯类型并 re-export 类型。core/renderer/
  harness 改 import。shared-types 回归零逻辑(以 `export function` 计数
  归零为验收线,类型守卫函数除外,逐个列明)。
- `packages/renderer` 改名 `@offisim/prefab`(目录同步 `packages/prefab`),
  更新五个引用点(platform seed ×2、desktop renderer ×3)与
  workspace 配置。
- 验收:全仓 build 串行顺序照旧;node lane 全绿;
  `check-cross-package-src-imports` 绿。

### PR-S2 repositories.ts 按域拆
- `runtime/repositories/{company,thread,run,mission,loop,collaboration,mcp,memory,settings}.ts`
  纯 interface 迁移,`repositories.ts` 只留聚合 `RuntimeRepositories` 与
  re-export。零行为。
- 验收:全仓 typecheck。

---

## 3. 合同修订(2026-07-19,计划所有者拍板,覆盖上文冲突条款)

执行方 2026-07-19 上报四处计划-现实冲突,证据成立,修订如下:

1. **A1/A2 日志一致性**:「迁移前后 log 逐字节一致」收窄为
   「check 行(✓/✗)与退出码逐字节一致;旧自定义统计/摘要行允许替换为
   runner 标准摘要行」。锚点 `harness-runner.mjs` 保持不改。
   **范围修订**:74 个无本地 check 骨架的 harness(conflict-classification
   `noLocalRunnerChecks`)移出 A2 范围,保持原样;A2 仅迁移 30 个
   `customSummaryRunnerChecks`。A3/A4 与 A1/A2 无实质依赖,解除冻结,
   D1-D3 随 A3 解冻。
2. **B2 live 验收措辞**:「app 重启后 reattach 续流」更正为「重启后运行
   身份保持、状态落为 interrupted/CAN RESUME、可手动恢复且无重复副作用」。
   不引入持久 broker/自动续跑(计划外架构,产品上也不要)。B2 以
   非回归证据(与 B1 基线行为一致)满足验收;B3 随之解封。
3. **S1 验收线**:「shared-types 回归零逻辑」收窄为「dramaturgy/ 目录零
   运行时函数」(已达成)。shared-types 其余 48 个非类型守卫运行时函数
   记为 S3 候选(需 ownership 设计,另立计划,不在本轮)。
4. **U5 远端 publish**:当前环境 registry 端点为故意不可路由占位
   (prelaunch 无真实 registry),远端 publish 改为不可执行项;验收 =
   本地 install/Board/Activity live 通过 + publish 表单完整可达且离线态
   文案正确(已达成)。真实 registry 上线后另补一次远端回归。

## 4. 审计结果(2026-07-19,Fable 全量审毕)

14 PR 全审(B2/C1 由计划所有者逐行审,其余 7 路并行独立复核,均为全量非抽样)。
**零 blocker。** 判定与合并前提:

- **直接可合(无前提)**:#90 B1、#91 C1、#92 B2、#97 B3、#93 U1、
  #103 U5、#100 U2、#101 U3、#98 S2。
- **合并前小修**:
  - #94 A1:补「validate 必含 run-harnesses.mjs」断言×3
    (harness-pi-agent-host.mjs:1166 / harness-review-fixes.mjs:55 /
    harness-stream-watchdog.mts:362);同步锚点 checkAsync 失败行改为
    带完整 stack 的多行输出(锚点已由所有者在 main 工作树修订并自测)。
  - #96 S1:回补被剥离的 18 处残留类型 JSDoc(重点 SceneBeat 字段注释与
    lifecycle replay 契约段,base beat-composer.ts:143-161;另 ambient×6、
    staging×5、mission-projection×3 等)。
  - #95 C2(建议):harness-codex-app-server-contract.mjs 对
    agentHostRuntime 语料同样剥 `#[cfg(test)]` 段。
  - #102 U4(建议):证据 README 两个畸形 SHA(59 位)重算修正。
- **批准偏离(记录在案)**:B2 用注入回调替代 ctx.mode 内部分支(优于原
  spec);B3 随迁 buildLiveConversationTerminalMessage;U3 九卡清单换 2
  (静态无选中态卡出圈,换真可选中卡,语义更正);S2 按实际 4 函数+3 常量
  逐字随迁(原「纯 interface」假设不实)。
- **A2 后续**:#99 为历史阻塞证据(已被 §3 修订消解),按修订范围执行
  30 个 customSummaryRunnerChecks 迁移(worktree 留存草稿可复用),完成后
  A3/A4、D1-D3 依序推进。
- 建议合并顺序(栈内严格按序,栈间任意):B 链 #90→#92→#97;C 链
  #91→#95;U 链 #93→#103、#100→#101、#102;S 链 #96(修后)→#98;
  A 链 #94(修后)。merge 一律等用户批准。

## 5. 审计约定(Fable 额度恢复后)

- 逐 PR 审:diff 与本文档规格逐条对照;「纯移动」PR 用
  move-detection diff 核对新旧内容一致;B2/C1 两个高风险 PR 逐行审。
- 执行方每个 PR 描述里必须写:偏离计划的点(哪怕零)、live 验证证据
  (截图/录屏路径)、gate 输出摘录。无证据 = 不进审计队列。
- 本文档即验收合同;执行中发现计划错误,在 PR 描述记录并停在该 PR,
  不自行扩散修改。
