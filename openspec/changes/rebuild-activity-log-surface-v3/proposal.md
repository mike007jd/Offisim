## Why

V3 设计稿把 Activity Log workspace 定为**单列时间线**（full-width `ActivityTimeline`，`grid-cols-1`）+ 选中事件揭示**一个**右侧 detail 列（split → `1fr minmax(320px,420px)`，≤420px），V3 grammar，drop bell。这与当前代码已经一致（`ActivityLogPage` 的 content grid 是 `grid-cols-1` → `grid-cols-1 md:grid-activity-detail`，`grid-activity-detail = 1fr minmax(20rem,26.25rem)`）。event store / ring buffer / filter / grouping 管道是行为层（`activity-feed-composition` capability 已落地，薄 hook + 13 mapper + FIFO 200 ring buffer + collapse ×N）—— 本 phase 只重做 **activity-log workspace 的视觉/chrome**：把 filter bar / event row / detail panel 的 className 重皮到 V3 tokens，**不动布局栅格、不动行为层**。依赖 Phase 0 token。

> Phase 0 precondition：本 change 假定 Phase 0（V3 token 基础）已 apply，V3 设计 token 已在 renderer 可用。

## What Changes

- **单列时间线 + split detail 列（视觉重皮，布局不变）**：保持现状的 `grid-cols-1` 单列 `ActivityTimeline`，选中事件 → `grid-cols-1 md:grid-activity-detail`（`1fr minmax(20rem,26.25rem)`，≤420px）的 split，揭示**一个** `ActivityEventDetail` 列。**不引入多列事件网格** —— prototype 与现有代码都是单列。本 phase 只把 timeline / row / detail 的 chrome（border / bg / spacing / typography）重皮到 V3 tokens。
- **filter bar V3 grammar**：`ActivityFilterBar`（h-14/56px，`grid-activity-filter = repeat(3,minmax(0,1fr)) minmax(10rem,2fr)`）的 date/type/actor 3 个单选 + search 用 V3 container-grammar；保留 4 维过滤管道（date→type→actor→search）行为不变。
- **detail panel V3**：`ActivityEventDetail`（5 段：EventType/Level/Timestamp/Entity/Payload）用 V3 sectioned grammar + `ActivityPayloadView` 递归 tree 保留。
- **event row V3 grammar**：`ActivityEventRow` 用 V3 grammar（level border + domain icon + label + collapse `×N` badge + timestamp）。
- **drop bell**：activity-log 内确认无铃铛（已合规）。

**明确不动（行为层 + 布局栅格锁定）**：`primeEventLogStore`/`hydrateEventLogStore`/`disposeEventLogStore`（per-prefix 订阅 + FIFO 200 + 幂等 dispose）、`EVENT_PREFIXES`（25 个 prefix）/`TYPE_PREFIX_MAP`、`activity-log-filter.ts` 管道、`activity-log-grouping.ts` 的 collapse ×N（`task.assignment.rerouted` 3+）、`ActivityLogPage` 的 content grid 列定义（`grid-cols-1` ↔ `grid-activity-detail`）、`ActivityLogSessionState` 形状、office 右栏 activity rail（属 Phase 1/2）。

## Capabilities

### New Capabilities
- `activity-log-presentation`: Activity Log workspace 的 V3 视觉/chrome 契约 —— 单列时间线 + 选中揭示一个右侧 detail 列（split ≤420px）、event row V3 grammar（level border + icon + label + collapse badge + timestamp）、filter bar V3 grammar（保留 4 维过滤）、detail 5-section sectioned。明确不改 event store / ring buffer / filter / grouping 管道行为，也不改 content grid 的列结构（仍是单列 ↔ split）。

## Impact

- 代码：`packages/ui-office/src/components/events/` 下的 `ActivityLogPage.tsx` / `ActivityFilterBar.tsx` / `ActivityTimeline.tsx` / `ActivityTimeGroup.tsx` / `ActivityEventRow.tsx` / `ActivityEventDetail.tsx` / `ActivityPayloadView.tsx` 的 JSX className（仅 chrome 重皮）。`EventLog.tsx`（`primeEventLogStore`/`EVENT_PREFIXES` 25/`TYPE_PREFIX_MAP`/FIFO 200）、`activity-log-filter.ts`、`activity-log-grouping.ts` **不动**。注意：这些文件直接位于 `components/events/`，**没有** `components/events/activities/` 子目录。
- blast radius：`ActivityLogPage` 经 WorkspaceRouter 挂载（lazy）；纯视觉/chrome 改动不动 event store / grouping / routing，也不动 content grid 列定义。无新增 session-state 字段。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：单列时间线 + ≤420px split detail（重皮到 V3 tokens）/ row grammar / filter 4 维 / collapse ×N / 无铃铛 / event 实时流不破。
