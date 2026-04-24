# Roadmap Debt Ledger

This file is the source of truth for roadmap debt reviews. Do not use raw unchecked counts from `openspec/changes/archive/**/tasks.md` as a roadmap metric.

## Classification Rules

| Bucket | Meaning | Standard label | Roadmap treatment |
| --- | --- | --- | --- |
| `True debt` | A capability, verification, or product contract is still open. | N/A | Keep in the active roadmap. |
| `Docs/process cleanup` | Canonical spec drift, `CLAUDE.md` drift, `Purpose` backfills, archive bookkeeping, or `openspec validate` hygiene. | `Documentation drift; convert to docs/spec sync debt, not feature debt.`<br>`Repo hygiene / archive bookkeeping; not product roadmap debt.` | Track separately from product debt. |
| `Historical excluded` | Cancelled, deferred, superseded, or bookkeeping-only historical items. | `Cancelled historical scope; excluded from roadmap debt.`<br>`Deferred into follow-on change; track only the successor change.`<br>`Superseded by later archived change; excluded from current roadmap debt.` | Exclude from current roadmap debt totals. |

## Current Rollup (2026-04-22)

### True debt

| Item | Why it remains true debt | Primary evidence |
| --- | --- | --- |
| Provider lane exposure / host gating / verification matrix | Product-centric provider work is underway, but lane exposure policy and evidence closure are not fully complete. | `openspec/provider-lane-matrix.md`, `openspec/specs/provider-product-taxonomy/spec.md` |
| Agent SDK lanes without Offisim tool-enabled turns | `claude-agent-sdk` and `openai-agents-sdk` are not yet drop-in replacements for tool-enabled Offisim turns. | `packages/core/src/llm/claude-agent-sdk-adapter.ts`, `packages/core/src/llm/openai-agents-sdk-adapter.ts` |
| Codex local-auth resolver | Product entry exists, but trusted-host local auth is not yet fully wired end to end. | `apps/desktop/src-tauri/src/runtime_secrets.rs` |
| Skills UX/product closure | The skill platform is live, but upload affordances, local sync UX, and end-user evidence are not fully closed. | `openspec/specs/skill-fork-and-edit/spec.md`, archived T2.1/T2.3 verify records |
| A2A server completeness | Outbound/external employee wiring exists, but full server completeness is not finished. | `packages/core/src/a2a/a2a-server.ts` |
| External contributor avatar metadata tail | External employee brand avatars are live, but contributor metadata for deliverables is not fully propagated. | `packages/ui-office/src/components/deliverable/DeliverableCard.tsx` |

### Docs/process cleanup

- `roadmap-debt-reconciliation` closes the currently known canonical drift in `employee-node-boundaries`, `typed-json-field-parsers`, package `CLAUDE.md`, and the archived `Purpose TBD` backlog.
- Future `openspec validate`, archive SHA/MEMORY/queue notes, and similar repo hygiene items belong here and do not count as product debt.
- Any future canonical spec or `CLAUDE.md` drift that does not correspond to an open capability gap belongs here and should not be promoted into `True debt`.

### Historical excluded

| Historical item | Classification | Current handling |
| --- | --- | --- |
| `2026-04-18-refactor-prefab-config-schema-cancelled` | `Cancelled historical scope; excluded from roadmap debt.` | Keep the archive record; do not reopen it as current debt. |
| Deferred tail in `2026-04-17-refactor-repo-triple-copies` | `Deferred into follow-on change; track only the successor change.` | Track only the successor continuation change, not the old unchecked list. |
| Remaining unchecked live-verify items in `2026-04-21-fix-desktop-direct-chat-readonly` | `Superseded by later archived change; excluded from current roadmap debt.` | Keep the historical note, but do not count those unchecked boxes as open product debt. |
| Archive/bookkeeping-only unchecked items | `Repo hygiene / archive bookkeeping; not product roadmap debt.` | Track as docs/process cleanup only. |
