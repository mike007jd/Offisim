# Live verify notes — split-shared-types-events-by-domain

Date: 2026-04-18
Env: `pnpm dev` (web) on `localhost:5176`

## Static gates

- `events.ts` NBNC = 27 ≤ 60 ✓
- `events/*.ts` = 27 files (18 listed in spec + 9 orphan domains covered: install / direct-chat / report / ui / rack-slot / cost / notification / vault / prefab)
- `^export interface \w+Payload` per file count = 1 each (no cross-file duplicates)
- `RuntimeEvent<` only defined in `events/core.ts`
- `grep '^export interface .*Payload' events.ts` = 0 (no inline payload in barrel)

## Build + typecheck

- `pnpm --filter @offisim/shared-types build` ✓
- `pnpm --filter @offisim/ui-core build` ✓
- `pnpm --filter @offisim/core build` ✓
- `pnpm --filter @offisim/ui-office build` ✓
- `pnpm --filter @offisim/web build` ✓
- `pnpm typecheck` 26/26 ✓ — every consumer `import type { XPayload } from '@offisim/shared-types'` resolves through the barrel

## Live runtime

- Cold reload on `localhost:5176` → 0 console error, full UI tree renders (TEAM panel with 8 idle employees, Chat tab, Ready status).
- Sent `"Say hi in one sentence"` in Chat:
  - Pipeline ANALYZING appeared in status bar → Boss reasoning streamed (600+ char reasoning chunk visible) → Boss direct_reply completed with `"Hi there! How can I help you today?"`.
  - Final stats: `2.1K tokens / $0.0026 / LAT 8.0s`, runtime returned to idle.
  - This exercised event families: `llm.call.started`, `llm.stream.chunk` (reasoning channel), `graph.node.entered`, `graph.node.exited`, `llm.call.completed`, `llm.usage.recorded`, `cost.session.updated`, `boss.route.decided`, `task.state.changed` — every one of these resolves through a different domain file post-split, and every consumer wired correctly.
- Console filter `error` across the full session: empty.

## Observable behavior diff

- None. Types are compile-time only; runtime payload shapes are byte-identical.
