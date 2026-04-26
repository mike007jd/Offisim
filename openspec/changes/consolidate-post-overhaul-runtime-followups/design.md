## Context

UX/IA overhaul 8-phase 闭环（A1-A4 / C0-C2 / D1-D3 / E1-E2 / F0-F1 / G1 / H1 全 archived）后散出 5 条 verify 期间观察到的 followup（4 个 surface bug + 1 个 ad-hoc paperwork formalize），加上 Skills 体系最后一块未补的能力 T2.4 self-authoring。这是个**伞 change**：6 个互不相关的 fix/feature 一次提交，让 codex 长程 session 一次性扛完。每个 sub-fix 在自己的 capability 下落 ADDED/MODIFIED requirements，tasks.md 分 6 段，互相不强制依赖（codex 可以并行或串行推进）。

实施纪律：codex 在 6 段中 **#1 LangGraph dispatcher recursion 必须先做 root-cause investigation 再写 fix**，不允许上来 patch surface（recursion limit 25 是症状，根因可能是 dispatcher → step_advance → step_dispatcher 边的状态机 race / 缺少 step.completed 信号短路）。其余 5 条症状清楚，可直接 implement。

## Goals / Non-Goals

**Goals:**

- 6 条 followup 一次 propose / apply / archive，避免 6 轮 spec/tasks/verify 循环。
- 每条 fix 落到既有或新建 canonical capability，spec 表达 invariant 而不是 fix 本身。
- LangGraph dispatcher 修完后 `step_dispatcher → step_advance → step_dispatcher` 循环不再撞 recursion limit；任意 SOP（含 codex 在 E2 verify 撞到的死循环 SOP）跑得通。
- 同一 conversationKey 一次 round-trip 后 chat panel 仅有一条 assistant message。
- Tauri release `.app` CSP 允许 platform dev origin (`http://localhost:4100` + `tauri://localhost`)，与 dev 行为一致。
- Web direct chat target 切换后 100% 后续 tool call target 解析为 selectedEmployeeId。
- T2.4 employee tool `create_skill_from_scratch` 走 staging + commit 链路，frontmatter 严格白名单，preview bubble `'create'` 分支可用。

**Non-Goals:**

- 不重写 LangGraph 主图结构 / 不引入新 agent node — root-cause 分析后只在 dispatcher 节点 + 边路由内改。
- 不动 SOP DAG editor（E1 已 archived，本 change 只动 runtime 层）。
- 不动 chat session store schema / 不引入新事件 — `chat-streaming-ux` requirement 是 invariant 描述，落地在已有 `finalizeActiveRun` / message commit 链路。
- 不重新设计 desktop CSP 模型 — 只补 platform endpoint allowlist。
- 不改 chat target resolver 的 dispatch 协议 — 只修复浏览器侧 selectedEmployeeId 漏传 / 被覆盖的具体路径。
- 不引入第二种 skill staging 模型 — T2.4 严格复用 T2.2 `SkillInstallCommitter`。
- 不接 agentskills.io 或外部 registry —— Market 只自家生态，决策已 locked。

## Decisions

### D1 (#1 LangGraph dispatcher recursion) — root-cause first, surface fix forbidden

**选择**: codex 实施时先复现 + 看 dispatcher 状态机，再写 fix。tasks.md 1.x 段第一条就是 investigation，必须产出 reproduction recipe + dispatcher state diagram + 根因 paragraph，写进 implementation notes 后才能动代码。

**理由**: recursion limit 25 是 LangGraph 内置兜底，撞到说明 graph 内部 loop 没收敛信号。直接 patch limit（提到 50 / 100）只挪问题 horizon，下一条复杂 SOP 还会撞。常见根因猜测（按概率）：
1. `step_dispatcher` 没看到 `step.completed` 信号 → step_advance 后回退 step_dispatcher，再次调度同 step；
2. 多个 step 共享 dependencies，dispatcher 找不到 newly unblocked step 仍然路由回自己；
3. employee node 完成但 state.plannedSteps 没更新到 terminal；
4. routeFromStepAdvance 在某些 plan shape 下永远不返回 `boss_summary`。

**理由 (cont)**: 真根因可能是上述任一组合，或全是。codex 的 root-cause investigation 必须复现一次（用户在 E2 verify 用 Playwright 直打 plan/task 事件绕过 dispatcher 已经触到 — 复现路径仍在 chat history），打印 LangGraph state at recursion entry，看 plannedSteps + completed set 是否真有 step 应该 advance 但没 advance。

**对比**: surface fix（只把 recursion limit 25 提到 50）放弃理由：症状缓解不解决根因，T2.4 等更复杂 SOP 会撞同一坑。

### D2 (#2 doubled boss bubble) — single commit at finalize, no double-write

**选择**: chat-streaming-ux capability 加 invariant 「streaming 收尾后同一 conversationKey + 同一 assistant turn 只允许一条 `appendMessage(role: assistant)` 写入」。fix 路径在 `useChatStreamingSync` / `finalizeActiveRun` 之间——调查是 streaming tail commit 又 final commit 双写，还是 reasoning region 渲染了一份正文 + message commit 又写一份。

**理由**: live verify 看到的两条气泡内容一致（一条带 reasoning fold + 正文，一条只正文）说明 message store 真有两条 row，不是 React render 的双重 portal。修法是找到 commit 路径上 race / double-call 点，加 dedupe 或单一 finalize 入口。

**对比**: 不在 UI 层做 dedup（治标不治本，message store 里仍是两条 row，影响 history export / kanban 引用）。

### D3 (#3 update-llm-gateway-default-model) — formalize landed change

**选择**: `llm-gateway-provider-binding` capability 加 requirement 把「MiniMax-M2.7-highspeed token plan no longer supported; default model is `MiniMax-M2.7`」明确写入 spec。代码已落（commit `f3bb26dd`），本 change 不动代码，只补 spec 段 + 更新 catalog comment（如果 catalog 里还残留 highspeed 注释）。

**理由**: ad-hoc 修 spec scenario 没走正式 propose/archive 留下断档，未来 grep "highspeed" 可能还能找到老引用，没明确"为什么不再支持"的契约表达。

**对比**: 让 ad-hoc 留在 spec 里不补 paperwork — 风险是未来回查 highspeed 引用时缺失上下文，回滚或参考时可能不知道 highspeed 是被主动放弃。

### D4 (#4 Tauri release CSP + platform allowlist) — release-mode CSP must accept localhost:4100

**选择**: `desktop-llm-credential-isolation` capability 加 requirement「Tauri release `.app` CSP allow list 含 `http://localhost:4100` (platform API) + `tauri://localhost`」，与 `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` 注释一致。

**理由**: dev 跑 webview 时 platform endpoint 走 `localhost:4100` 工作正常，release `.app` 同 endpoint 撞 CSP block。两边 CSP 应统一对齐 — release 不该比 dev 更严，否则 verify 路径分裂（dev 通 release 不通是常见 bug 来源）。

**对比**: 让 release CSP 严格收口（不允许 localhost）— 放弃，因为本地 platform daemon 是 desktop 默认部署模式（`pnpm --filter @offisim/desktop dev` 期望 platform 已起）；强行收紧 CSP 等于逼用户配 production endpoint。

### D5 (#5 web direct chat target mismatch) — selectedEmployeeId 必须 100% 命中

**选择**: `office-chat-default-presentation` capability 加 requirement「direct chat 切换后所有后续 sendMessage / tool call 的 target 必须解析为 selectedEmployeeId，不允许 fallback 到 active employee 或其他启发式」。fix 在 chat target resolver — 找浏览器侧路径上哪个 caller 漏传了 selectedEmployeeId 或被默认值覆盖。

**理由**: T2.3 verify 看到 Maya 选中后 fork_skill preview 落 Alex Chen，意味着 tool call dispatch 时 target 不是 selectedEmployeeId 而是其他 fallback。这违反「user 选了谁就发给谁」的产品契约。

**对比**: 在 UI 层 disable fork_skill 直到目标确认（产品 UX 倒退）— 放弃；不修是用户体验级别 bug。

### D6 (#6 T2.4 skill self-authoring) — strict frontmatter whitelist + reuse T2.2 commit pipeline

**选择**: 新 capability `skill-self-authoring`。employee tool `create_skill_from_scratch` 接 LLM body input → 走 `parseSkillMd` 严格白名单（`name`/`description` 必填，可选 `allowedTools`/`license`/`version`，**拒 `offisim.*` 私有命名空间和任何 unknown frontmatter 字段**）→ 失败抛 `SkillFrontmatterError`，preview bubble 显示 raw LLM 输出 + error reason，用户可 retry / cancel。通过白名单 → 走 T2.2 `SkillInstallCommitter` staging → preview bubble `'create'` 分支显示 SKILL.md preview + slug + scope（`employee` 默认）+ Confirm/Cancel → commit 写 vault + skills row（`source_kind='self-authored'`，`source_ref='llm-author:<modelKey>'`）。

**理由**: fork/edit 已落地 commit pipeline 全套（staging-expired 处理、二阶段 commit、commit error toast），create 是同 pipeline 的另一个 entry。frontmatter 白名单复用 T2.1 `parseSkillMd`，加 self-authoring 专属 strict mode（白名单 + 拒 offisim.* + 拒 unknown）。

**对比**: 让 LLM 直接写到 vault 跳过 staging — 放弃，破坏 T2.2 二阶段 commit 安全模型，且无 preview 用户没机会校对/拒收。

## Risks / Trade-offs

- **#1 LangGraph dispatcher 真根因复杂超出 codex investigation 时间预算** → mitigation: 如果 root-cause 投入 4h 仍找不到收敛点，tasks.md 允许 codex pause 写 investigation report 转独立 follow-up change（不让伞 change 因一条卡死）。
- **6 条伞 change 总验收链路长，单条出问题影响 archive** → mitigation: tasks.md 6 段独立打勾，archive 时按 OpenSpec Archive Gate 三查；任一条 live verify 红可以 documented as DEFERRED，不阻塞其他 5 条 archive（但需写明 follow-up）。
- **#2 boss bubble 修在 chat session store 可能引入新 race** → mitigation: 修前先看 finalize 调用路径，写 message commit invariant 测试用 chat-session-store 单元覆盖（虽然仓库已删自动测试，但 message store 是纯函数，单测可以临时本地跑确认逻辑）。
- **#5 chat target fallback 路径可能不止一处** → mitigation: codex 全 grep `targetEmployeeId` 在 web direct chat path 上的所有 caller，逐个核对 selectedEmployeeId 注入；写 invariant requirement 兜底「caller 必须显式传 target，缺失抛 error 而不是 fallback」。
- **#6 LLM 输出 frontmatter 边缘 case 多（YAML edge syntax / 嵌套字段 / Unicode 等）** → mitigation: 复用 T2.1 已有 `parseSkillMd` 严格 schema，self-authoring 入口加额外白名单 set；live verify 必须包含至少 3 条错构 frontmatter（unknown field / `offisim.*` / 缺 required）的拒收路径。
- **#3 paperwork 与代码已落地的 timestamp 错位** → mitigation: spec scenario 加 explicit "as of 2026-04-26 commit `f3bb26dd`" 标注，避免未来读 spec 不知道是新增还是回填。

## Migration Plan

按 followup 独立性，6 条可并行或串行；推荐顺序：
1. **#3 update-llm-gateway-default-model**（paperwork only，无代码改动，最快收尾）
2. **#5 fix-web-direct-chat-target-mismatch**（surface fix，scope 收敛在 chat target resolver）
3. **#2 fix-doubled-boss-bubble**（surface fix，scope 收敛在 finalize/commit 路径）
4. **#4 fix-tauri-release-csp-platform-allowlist**（Tauri config + capabilities，scope 清晰）
5. **#1 fix-langgraph-step-dispatcher-recursion**（root-cause 投入大，单独留足时间）
6. **#6 add-skills-self-authoring**（新 capability，scope 最大；放最后是因为前 5 条 verify 期间可能蹭出新 followup）

每条独立 commit（`fix(...)` / `feat(...)` 前缀），合并到 archive 时单条 archive change 名仍是 `consolidate-post-overhaul-runtime-followups`。

**Rollback**：6 条都纯增量 / 修补，无 destructive 步骤。代码 revert per commit；spec revert by 删 ADDED requirement / 还原 MODIFIED block。#3 是文档化 already-landed change，rollback 等于把 spec 回到 ad-hoc 状态。

## Open Questions

- **Q1**: #1 dispatcher fix 后是否需要把 LangGraph recursion limit 从 25 提高（即使根因修了仍可能某些极端 SOP 撞 limit）？默认**不提高**，让 limit 25 当 canary；如果 codex root-cause 后认为某些 plan shape 合法但天然超过 25 步，提议作为单独 follow-up，不在本 change scope。
- **Q2**: #6 self-authoring 是 employee scope 默认还是允许 LLM 选 company scope？默认 **employee scope only**（T2.2 install + T2.3 fork 也都是 employee scope 优先，company scope 要走 publish）；LLM 不允许直接写 company scope，避免污染共享空间。
- **Q3**: #6 创建后是否立即可用还是要 publish 到 Market？默认 **立即可用**，scope=employee 不走 publish；company-wide 共享要走另一条 publish flow（不在本 change scope）。
- **Q4**: #4 release CSP allowlist 是否要把 platform endpoint 设成 env-driven（`OFFISIM_PLATFORM_URL`）而不是硬编码 localhost:4100？默认**硬编码 localhost:4100**（与 dev 行为对齐），env-driven 留给未来 production deploy 时再做。
