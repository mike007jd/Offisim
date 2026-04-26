## Why

UX/IA overhaul 8-phase（A1-A4 / C0-C2 / D1-D3 / E1-E2 / F0-F1 / G1 / H1）全线关闭后，散出 5 条 verify 期间观察到的 followup（4 条 surface fix + 1 条 ad-hoc paperwork formalization），加上 Skills 体系最后一块未补的能力 T2.4「员工自创建 skill from scratch」。逐条单 propose 节奏太慢；6 条都是局部 scope、彼此独立、风险面小，打包让 codex 长程一次性扛比 6 轮 propose-apply-archive 划算。

## What Changes

- **#1 SOP step_dispatcher recursion 死循环修复**：E2 sop-run-surface live verify 抓到 LangGraph `step_dispatcher` 在某些 SOP 路径下撞 recursion limit 25 死循环。**先 root-cause investigation，再写 fix**——不允许 surface patch；codex 实施前必须先复现 + 看 dispatcher 状态机，再写最小 fix。可能根因：dispatcher 没看到 `step.completed` 信号 → 重新调度同 step。`sop-run-surface` capability 加新 requirement 约束 dispatcher 不得在 `step.completed` 后重调同 step，并补 recursion limit observability。
- **#2 doubled boss bubble 修复**：desktop credential isolation live verify 看到 team chat `hi` 成功 stream 完后 Boss 气泡出两条相同正文（一条带 reasoning fold + 正文，一条只正文）。可能是 streaming tail commit + final commit 双 write，或 reasoning region + 正文 double render。`chat-streaming-ux` capability 加 requirement 约束「streaming 收尾 → 同 conversationKey 仅一条 assistant message commit」。
- **#3 update-llm-gateway-default-model 正式归档**：commit `f3bb26dd` 已把全局默认 `MiniMax-M2.7-highspeed → MiniMax-M2.7`（catalog/env/vite.config/provider-config 全切，canonical `llm-gateway-provider-binding` scenario 措辞已是 M2.7）。本 change 是 paperwork——`llm-gateway-provider-binding` 加 requirement 把「不再支持 highspeed token plan」明确写入 spec，避免回滚或参考混淆。
- **#4 Tauri release CSP + platform allowlist 收口**：C0 desktop release verify 抓到 Tauri release CSP 拦本地非白名单端口（`127.0.0.1:43177` Load failed，`localhost:4100` 通），与 commit `a6d6a316` dev origins fix 是姐妹问题。`desktop-llm-credential-isolation` capability 加 requirement 把 release CSP allow list 与 dev allowlist 对齐；platform `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` 注释纳入 spec。
- **#5 web direct chat target mismatch 修复**：T2.3 web live verify 期间观察 — 浏览器 direct chat 选 Maya 时 `fork_skill` preview 偶发落到 Alex Chen。`office-chat-default-presentation` capability 加 requirement 约束「direct chat 切换后所有后续 tool call 的 target 必须解析为 selectedEmployeeId，不允许回退到 active employee」。
- **#6 T2.4 skills self-authoring 新能力**：员工 LLM-author 新 skill from scratch 路径（fork/edit 已有，自创建是延伸）。新 capability `skill-self-authoring` 含：(a) employee tool `create_skill_from_scratch`，(b) LLM 输出 → SKILL.md frontmatter 严格白名单审查（拒 `offisim.*` 私有命名空间，强制 `name + description` 必填，可选 `allowedTools/license/version`），(c) staging + 二阶段 commit 复用 T2.2 `SkillInstallCommitter` 链路，(d) preview bubble 复用 `SkillInstallConfirmBubble` 加 `'create'` action 分支，(e) live verify 路径含 LLM 错构 frontmatter 的拒收。`skills-foundation` 加 self-authoring 入口 requirement，`agent-mediated-skill-install` 加 `'create'` action confirm flow scenario。

## Capabilities

### New Capabilities

- `skill-self-authoring`: 员工 LLM-author 新 skill from scratch 的能力。覆盖 employee tool `create_skill_from_scratch`、LLM 输出 frontmatter 白名单审查、staging + 二阶段 commit、preview bubble `'create'` 分支、错构 frontmatter 拒收路径。

### Modified Capabilities

- `sop-run-surface`: 加 dispatcher 不得在 `step.completed` 后重调同 step 的 requirement + recursion limit observability。
- `chat-streaming-ux`: 加 streaming 收尾仅一条 assistant message commit 的 requirement。
- `llm-gateway-provider-binding`: 加 MiniMax-M2.7-highspeed 不再支持的明确 spec 条款。
- `desktop-llm-credential-isolation`: 加 release CSP allow list 与 dev allowlist 对齐 + platform `DEV_DEFAULT_ORIGINS` 契约。
- `office-chat-default-presentation`: 加 direct chat 切换后 tool call target 解析必须命中 selectedEmployeeId 的 requirement。
- `skills-foundation`: 加 self-authoring 入口 requirement（loader / vault 路径与 fork/edit 一致）。
- `agent-mediated-skill-install`: 加 `'create'` action confirm flow scenario。

## Impact

- **Runtime**：#1 触 LangGraph dispatch loop，可能要 graph node 改 / state machine 调整（codex root-cause 阶段决定）；其余 4 条 surface 影响小。
- **Schema**：无 schema 变更（#6 复用现有 `skills` 表 + vault 路径契约）。
- **UI**：#2 chat message commit 路径；#5 chat target resolver；#6 preview bubble `'create'` 分支 + tool 注册。
- **Tauri**：#4 capabilities/default.json + `tauri.conf.json` CSP allow list；platform `DEV_DEFAULT_ORIGINS`。
- **Docs**：CLAUDE.md（root + ui-office + core）+ protocols-ledger.md（LangGraph 行可能要补 dispatch state machine 注脚）。
- **不影响**：scene / SOP DAG editor / Personnel / Studio / Market / Project workspace_root。
- **Rollback**：6 条都纯增量 / 修补；#3 是文档化已发生的事；#6 新 capability 加 feature flag 就能回退。无 destructive 步骤。
