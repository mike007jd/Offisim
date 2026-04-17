# Live verify notes — refactor-activity-feed-hook

Date: 2026-04-18
Env: `pnpm dev` (web) on `localhost:5176`

## Static gates

- `use-runtime-activity-feed.ts` NBNC = 176 ≤ 180 ✓
- `activity-feed/mappers/*.ts` = 13 files exact ✓
- barrel `grep eventBus.on` = 0 ✓
- `useState<RuntimeActivityEntry[]>` only in `useActivityRingBuffer.ts` ✓
- no cross-mapper import (each mapper imports only `../../runtime/..` + `../activity-types`)

## Build + typecheck

- `pnpm --filter @offisim/ui-office build` ✓
- `pnpm --filter @offisim/web build` ✓
- `pnpm typecheck` 26/26 ✓ (23 cached, 3 new: shared-types downstream)

## Live runtime

- Cold reload `localhost:5176` → 0 console error.
- Sent `"Write a haiku about morning coffee"` in Chat; Boss chose `delegate_manager` route — full delegate path ran end-to-end: Boss analyzing → Manager routing → PM planning → Jamie Reeves executing → Boss reporting → deliverable.
- Final metrics: `7.8K tokens / $0.0134 / LAT 43.0s`. Pipeline DELIVERING → idle.
- `totalCostUsd` updated in footer status bar (cost mapper → `setTotalCostUsd` sink).
- Activity rail headline advanced through stages: "Boss analyzing" → "📊 assign to Jamie Reeves since they just…" (manager setHeadline via interaction/plan mappers).
- `ceremony` state: "8 participants · 1 dispatched · Manager present" (from scene orchestrator, independent of activity feed — shows ring buffer didn't break ceremony pipeline).
- DOM pattern grep across rail: `"finished"`, `"Step "`, `"completed"` all present — at least 3 mapper families are producing entries end-to-end:
  - `graph-mappers.ts` → graph.node.exited → `"X finished"` entries
  - `plan-mappers.ts` → plan.step.completed → `"Step N completed (M outputs)"`
  - `llm-mappers.ts` → llm.call.completed → `"X completed call in ..."`
- Plus setHeadline chain driven by `interaction.requested` / `graph.node.entered` / `plan.created` / `llm.call.started` path visibly advancing in status bar across phases.
- No mapper re-subscribed mid-task (sink useMemo deps `[push]` stable through hook lifetime).

## Observable behavior diff

- None. Hook return shape + entry tones/titles/timestamps identical; ring-buffer tool-burst merge preserved inside `useActivityRingBuffer.applyPush`.
