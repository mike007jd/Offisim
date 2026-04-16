# Baseline Notes — refactor-employee-node

## Verification strategy: Option B (post-only live verification)

Pre-refactor live capture (tasks 1.1–1.3) **skipped by user decision**. The
spec already pins event sequence / payload keys / `Command` shape — pre/post
diff would add marginal evidence over running post-refactor live verification
against the spec. Saves ~30 min and 3 live MiniMax roundtrips.

Post-refactor live verification (tasks 12.1–12.5) still required.

## Static baseline at commit `4af1edc7`

| Metric | Value |
|---|---|
| Captured at | 2026-04-16T10:58:53Z |
| `wc -l` | 1126 |
| NBNC (`grep -cvE '^\s*(//|$|/\*|\*)'`) | 980 |
| sha1 | `327de47f7c3a1fe9cf51d814f8b9c089a0c1d137` |

## Importers (must not change)

| File | Line | Statement |
|---|---|---|
| `packages/core/src/index.ts` | 332 | `export { employeeNode, extractUsedCitations } from './agents/employee-node.js';` |
| `packages/core/src/graph/main-graph.ts` | 8 | `import { employeeNode } from '../agents/employee-node.js';` |

Comment-only references (informational, not import):

- `packages/core/src/agents/employee-memory-tools.ts:7`
- `packages/core/src/agents/employee-local-recovery.ts:8`

`apps/web` has zero references — confirms barrel is core-internal only.

## Public exports from `employee-node.ts` (must remain)

| Line | Symbol |
|---|---|
| 150 | `extractUsedCitations` |
| 172 | `employeeNode` |

## Deferred live captures (skipped per Option B)

- `/tmp/employee-node-pre-normal.json` — not captured
- `/tmp/employee-node-pre-tool.json` — not captured
- `/tmp/employee-node-pre-handoff.json` — not captured

Static walkthroughs for handoff / error paths still mandated by §13 of
`tasks.md`.
