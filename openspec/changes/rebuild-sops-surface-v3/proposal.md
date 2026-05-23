## Why

V3 DNA §11 说 SOPs「already V3-aligned」，required changes 小：drop bell、run-strip 迁到 V3 status-tinted 家族、scope-bar grammar 对齐 V3、inspector 像 rail 的 sectioned scroll panel（`.insp-sec`：caps label + content blocks，`--line-soft` 分隔）。当前三栏 280|1fr|320 已对、DAG 渲染（HTML node overlay + SVG interaction layer 共享 transform）已合规。差距：(1) inspector 缺 `.insp-sec` `--line-soft` section 分隔 + `--sp-5` padding 节奏；(2) run-strip 虽已用 token，但用的是 legacy `--info`/`--success`/`--error` 系，需迁到 V3 `--accent`/`--ok`/`--danger`（**info→accent + success→ok 家族迁移，非 no-op**）。Phase 6 是**纯重皮肤**，不动 DAG 架构/拓扑/交互。依赖 Phase 0 token。

## What Changes

- **inspector sectioned panel**：`SopInspectorPanel` 的各段（label/role/status、instruction、dependencies、output key、last-error）改为 `.insp-sec` 节奏 —— caps label(`--fs-micro` uppercase `--ls-caps` `--ink-3`) + content block，段间 `--line-soft` 下边框（末段无），padding `--sp-5`。
- **run-strip token-family 迁移**：`SopRunProgressStrip` 当前用 legacy `--info`/`--success`/`--error` 系（`border-info bg-info-muted text-info` + `bg-success`），迁到 V3 status 系：run→`--accent-surface`+`--accent-ring`+`--accent`、done→`--ok-surface`+ok-tone、fail→`--danger-surface`+danger-tone（V3 DNA §2/§3 把 `--info` alias 到 `--accent`，无独立 info token）。pulse dot 同步随 state 取 `--accent`/`--ok`/`--danger`。border 用语义 token 而非硬 hex。**这是 info→accent + success→ok 的家族迁移，不是 verify-only no-op**（代码今天就用 token，只是用错家族）。
- **三栏 + scope-bar 确认**：280|1fr|320 保持；scope-bar/topbar grammar 对齐 V3（全局，与 Phase 2 一致）。
- **drop bell**：SOPs 内确认无铃铛（全局删除属 Phase 2/8）。

**明确不动（锁定）**：DAG 渲染架构（HTML node overlay + SVG ports/edges/drag-hit interaction layer，共享同一 graph translate/scale —— Tauri release 硬规则）、DAG 拓扑/topo-sort layout、drag-to-connect + cycle prevention、pan/zoom、node drag 持久化路径（`onMoveStep`→`updateDefinition`→`repos.sopTemplates.update(id, { definition_json })`）、`handleRun` role 校验、dispatch（`sendMessage(formatRunCommand)`）。

## Capabilities

### Modified Capabilities
- `sop-builder-canvas`: **MODIFY**「Step inspector reflects selection」—— 既有只读行为（label/role/status、instruction、dependencies、copyable output key、last-error）restate 不变，folding in V3 `.insp-sec` sectioned-panel grammar（caps label + `--line-soft` 段分隔 + `--sp-5` padding + `--sp-3` gap）作为一条 layout scenario。**MODIFY**「Release canvas layers share one graph transform」—— 既有三 scenario restate 不变，folding in 一条「Phase 6 reskin 不动 canvas transform」scenario（不另起重复的 transform-invariant 要求；base 已 bind）。「四区 builder shell」「node face I/O」「ports always rendered」「drag-to-connect cycle prevention」等其余既有要求保持不变。
- `sop-run-surface`: **MODIFY**「Run progress strip surfaces the in-flight run」—— 既有完整要求（mount 点、pulse dot、step counter、task tally、3s auto-clear、SOP scoping 五 scenario）restate 不变，folding in run-strip 的 info→accent + success→ok status-tinted token-family 迁移约束。其余（step 失败 chip / missing-role warning / edge 动画 / dispatch 边界 / `step_dispatcher` redispatch 守卫）保持。

## Impact

- 代码：`SopInspectorPanel.tsx`（sectioned `.insp-sec`）、`SopRunProgressStrip.tsx`（token 收口）。`SopDagCanvas.tsx` / `sop-dag-layout.ts` / `SopDagNode.tsx` / `SopDagEdge.tsx` **不动**（DAG 架构锁定）。
- blast radius：纯 inspector/run-strip 视觉；不动 DAG 交互/持久化/dispatch；`SopDagCanvas` props 签名不变。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：inspector sectioned + line-soft 分隔 / run-strip status-tinted / 三栏 280|1fr|320 / 无铃铛 / **DAG release 渲染无分层错位（node 卡片与 ports/edges 同步 transform）** / drag-to-connect + run 不破。
