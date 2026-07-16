# Prelaunch Vibe-Coding Debt Policy

Checked at: 2026-07-02 NZST.

Status: accepted working policy for AI-assisted Offisim cleanup and implementation.

## Why

Offisim has been built through long-running AI-assisted iteration. The recurring
risk is not only dead code; it is unstated agent assumptions. If an agent assumes
the product is already publicly launched, it tends to preserve or add migration
history, compatibility layers, rollout branches, fallback paths, and "minimal
viable" patches that protect imaginary production users instead of improving the
actual product.

Current external research matches this pattern:

- The 2025 "Vibe Coding in Practice" paper describes a flow-debt tradeoff where
  fast AI-assisted generation can accumulate architectural, security, testing,
  and maintainability debt.
- The 2026 GenAI-induced technical debt study finds AI-assisted code often shifts
  debt into requirement completion and testing/verification, especially when
  generated code is accepted without full understanding.
- Sonar's 2026 developer survey write-up frames the practical response as
  "vibe, then verify": keep the generation speed, but add deterministic
  accountability before code is treated as product truth.

For Offisim, the concrete countermeasure is to make project stage, real
boundaries, and anti-MVP completion rules explicit at the top of every agent
session.

Sources:

- https://arxiv.org/abs/2512.11922
- https://arxiv.org/html/2601.07786v1
- https://www.sonarsource.com/blog/how-ai-is-redefining-technical-debt/

## Current Stage Fact

Offisim is confirmed prelaunch: no real users, no production data, and no
historical compatibility contract that must be preserved.

Stage verdict: `confirmed-prelaunch`.

Implication: agents must not add or preserve migrations, compatibility layers,
fallback paths, or minimal patching for old local state. Real security,
external API/package, engine wires, MCP, project-file sandbox, and release `.app`
validation boundaries still require explicit oracles before changing.

## Retained Boundaries

These are real product contracts unless a narrower loop proves otherwise:

- Current local SQLite baseline (`schema.sql` + the `LOCAL_SCHEMA_VERSION`
  constant in `local_db.rs` — the constant is the truth source).
- Current engine wire/protocol contracts, sealed API secret references, native
  subscription auth/session boundaries, and safe exact model catalog metadata.
- MCP bridge, grants, approval status, and risk classification.
- `offisim://install`, `.offisimpkg`, package integrity, and install receipt
  semantics.
- Platform `/v1/*` API behavior, auth, moderation, and registry client contracts.
- Project file browsing through Tauri sandbox commands.
- Release `.app` validation path and local release evidence.

## False-Production-Assumption Smells

Treat these as discovery triggers, not automatic delete permission:

| smell | likely debt | first action |
|---|---|---|
| migration ledger, `0002..0012`, `MIGRATIONS`, `LOCAL_SCHEMA_VERSION = 12` | stale launched-user upgrade narrative | collapse to the current baseline unless a real post-launch contract exists |
| "temporary", "MVP", "minimal viable", "quick fix" | incomplete AI-assisted implementation | require complete product behavior and oracle |
| "legacy", "compat", "back-compat", "alias" | possible real contract or false compatibility | prove consumer/data boundary before changing |
| broad fallback or swallowed errors | safety theater or honest degraded mode | classify failure mode and user-visible contract |
| rollout, kill switch, dual path | deployment theater if never launched | collapse only after oracle proves target path |
| dead writer / live reader | honest feature gap | route to verified iteration, not blind deletion |

## Decision Rules

1. Treat Offisim as confirmed prelaunch until a future release-readiness loop
   records public-launch evidence.
2. Retain only explicit protected boundaries: security, external API/package
   contracts, engine/MCP wire, project-file sandboxing, and release `.app` behavior.
3. Prelaunch cleanup favors direct product truth over compatibility theater.
   Collapse false layers; do not replace them with new abstraction layers.
4. Complete delivery beats MVP. An implementation is not done because it compiles
   or handles the happy path; docs, harnesses, gates, and visible product behavior
   must agree.
5. Release readiness is separate. This policy can clean false assumptions, but it
   cannot certify a public release.

## Loop Routing

| debt type | loop |
|---|---|
| false migration, compatibility, rollout, fallback, safety theater | `prelaunch-assumption-convergence-loop` |
| ordinary dead code, stale docs, orphan exports | `dead-code-and-docs-cleanup-loop` |
| hand-rolled SDK/platform replacement | `sdk-overengineering-convergence-loop` |
| unknown bug/edge/redundancy discovery | `review-verify-fix-loop` |
| known backlog implementation | `verified-iteration-loop` |
| visual/product experience debt | `ui-ux-audit-loop` |
| model/provider/catalog freshness | `model-catalog-freshness-loop` |
| release package, public promises, app validation | `release-readiness-loop` |

## Agent Checklist

Before adding or preserving migration/compat/fallback/MVP-shaped work:

1. State the protected boundary: user data, external contract, security, package
   format, Pi/MCP wire, or none.
2. Choose `remove`, `collapse`, `reset-dev-only`, or `retain`.
3. Pick the smallest loop above.
4. Define the oracle before editing.
5. After editing, run GitNexus `detect_changes` plus the relevant repo gates.

## Current Known Cleanup Direction

- Keep one SQLite baseline only: the current `LOCAL_SCHEMA_VERSION`
  (truth source: `local_db.rs`), `schema.sql`, and
  `schema.ts`. Historical local migration SQL and `MIGRATIONS` registration are
  deleted debt.
- Keep durable Pi, MCP, install, platform, and project-file contracts.
- Treat inert storage tables as retained gaps until a deliberate baseline
  cleanup removes or rewires them.
- Treat Pi SDK freshness separately from hygiene cleanup.
