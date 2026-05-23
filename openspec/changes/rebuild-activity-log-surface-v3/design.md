## Context

文件直接位于 `packages/ui-office/src/components/events/`（**无** `activities/` 子目录）：`ActivityLogPage`(shell + event store hydrate + filter/grouping 管道 + 单列↔split 布局)、`ActivityFilterBar`(h-14，`grid-activity-filter = repeat(3,minmax(0,1fr)) minmax(10rem,2fr)`，date/type/actor 3 个单选 + search)、`ActivityTimeline`(单列时间组列表)、`ActivityTimeGroup`、`ActivityEventRow`(level border + icon + label + collapse badge + timestamp)、`ActivityEventDetail`(5 段)、`ActivityPayloadView`(递归 tree)。行为层（不动）：`EventLog.tsx`（`primeEventLogStore` / `EVENT_PREFIXES` 25 / FIFO 200 / `TYPE_PREFIX_MAP`）、`activity-log-filter.ts`（date→type→actor→search）、`activity-log-grouping.ts`（groupByTime + collapse ×N）。`activity-feed-composition` spec 锁定的薄 hook + 13 mapper + ring buffer 是**另一个 store**（`runtime/activity-feed/`），workspace **不消费**它 —— 本 phase 不碰那一层。

V3 prototype `offisim-activity-prototype.html` 的两条 CSS 是分开的，不要混淆：
- `.act-filter`（filter bar）：`grid-template-columns: repeat(3, minmax(0,1fr)) minmax(160px,2fr)` —— 3 个单选 + search。对应代码 `grid-activity-filter`。
- `.act-body`（content grid）：`grid-template-columns: 1fr`，selected 时 `.act-body.split` = `1fr minmax(320px, 420px)` —— **单列**时间线，选中后变 timeline + **一个** detail 列（≤420px）。对应代码 `grid-cols-1` ↔ `grid-activity-detail`（`1fr minmax(20rem,26.25rem)`，20rem=320px / 26.25rem=420px）。

prototype 7 个 specimen 全部渲染单列 timeline（含 narrow：选中后 timeline 隐藏、detail 占满整列）。**没有任何多列事件网格**。现有代码已与 prototype 一致；本 phase 是纯 chrome 重皮，不改布局栅格。

## Goals / Non-Goals

**Goals:** activity-log workspace 的 filter bar / event row / detail panel chrome 重皮到 V3 tokens；单列时间线 + split detail 布局保持不变；行为层零改。

**Non-Goals:** 多列事件网格（prototype 与代码都不存在，明确不引入）；content grid 列结构变更；event store / ring buffer / filter / grouping 管道行为；`ActivityLogSessionState` 形状变更；office 右栏 activity rail（Phase 1/2）；surface 配色基础（Phase 0）。

## Decisions

### D1 — 单列时间线 + split detail（布局保持，仅 chrome 重皮）
保持 `ActivityLogPage` content grid 现状：`grid-cols-1`（单列 `ActivityTimeline`）↔ 选中时 `grid-cols-1 md:grid-activity-detail`（`1fr minmax(20rem,26.25rem)`，揭示一个 ≤420px `ActivityEventDetail`）。同一 `filteredEvents` 数据，列定义不变，只重皮 timeline / row / detail 的 border / bg / spacing / typography。

### D2 — row / filter / detail V3 grammar
`ActivityEventRow` level border + domain icon + label + collapse `×N` + timestamp；`ActivityFilterBar` container-grammar（3 单选 + search，`grid-activity-filter` 保留）；`ActivityEventDetail` 5-section sectioned + `ActivityPayloadView` 保留。

### D3 — 行为层 + 布局栅格锁定
event store / 13-mapper ring buffer / `activity-log-filter` / `activity-log-grouping`（collapse ×N）不动；content grid 列定义（`grid-cols-1` ↔ `grid-activity-detail`）不动；`ActivityLogSessionState` 形状不动。只动 `components/events/` 下 UI 文件的 className/JSX（chrome）。

## Risks / Trade-offs

- **误读 prototype 为多列** → 已澄清：`.act-body` 是单列，多列出现在审计纠正前的 design 误把 `.act-filter` 的 3-列 filter 栅格当成 `.act-body`。本 phase 明确不引入多列事件网格。
- **detail 揭示交互**（click vs hover）→ click（现状：`handleSelectEvent` toggle，再次点同行关闭）；与 prototype 一致，不改。
- **误动 event store / grouping / filter** → 严格只改 `components/events/` 下 UI chrome；`EventLog` / `activity-log-filter` / `activity-log-grouping` 不进 diff。
- **误改 content grid 列定义** → 列定义（`grid-cols-1` / `grid-activity-detail`）属布局栅格，不在重皮 scope。

## Migration Plan

1. `ActivityFilterBar` / `ActivityEventRow` / `ActivityEventDetail` / `ActivityPayloadView` / `ActivityTimeline` / `ActivityTimeGroup` chrome 重皮到 V3 tokens（布局栅格不动）。
2. 串行 build + live 验（单列 + ≤420 split / event 实时流 + collapse ×N 不破）。
3. 回滚：`components/events/` UI 文件，单 commit 可 revert。

## Open Questions

- ~~多列是否 per-column type 过滤~~ → **已解决：无多列**。prototype `.act-body` 是单列 + split detail；代码已一致。本 phase 不引入多列，不扩 `ActivityLogSessionState`。
- ~~detail panel 揭示交互 click vs hover~~ → **已解决：click（现状 toggle）**，与 prototype 一致。
