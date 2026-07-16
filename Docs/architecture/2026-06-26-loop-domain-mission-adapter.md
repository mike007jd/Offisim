# Loop domain + Mission send-time adapter

Checked at: 2026-06-26 NZST
Status: accepted (PR-07 domain/IR/compiler, PR-08 UI, PR-10 send-time adapter)
Scope: a new Loop domain (definitions, immutable revisions, generic IR, compiler
profiles) and the rule that a Loop becomes a Mission only at Office Send. Does
**not** change the Mission engine internals, selected AI engine, or Office chat.

## Decision

A Loop is a saveable, versioned, reusable work-loop *definition*, not an
execution. A Loop revision compiles natural language into a generic `LoopIR` v1
that is the business truth; a `LoopExecutionPacket` adapter maps a pinned revision
onto the existing Mission engine only at Office Send. Save creates an immutable
revision and never a Mission, thread, or run. Mission remains the internal
execution-compatibility engine and is no longer a user-facing creation model.

## Context

The product needs reusable, named, versioned processes ("our PR review loop", "our
feature loop") that a user authors once and uses many times. Missions are the
existing execution engine, but a Mission is a single run — it is not a saveable,
re-usable, diffable definition. Three forces shaped the design:

- **Generic truth, not engine truth.** The saved artifact is a generic `LoopIR`
  (`packages/shared-types/src/loops/ir.ts`) — nodes, edges, cycles, subloops —
  independent of the Mission engine. This keeps Loops portable and lets the
  graph view (PR-09) and future compiler profiles project the same IR. The Mission
  shape is reached only through the `LoopExecutionPacket` adapter at run time.
- **Authoring vs. execution must not blur.** If Save executed, every edit would
  spawn a run, orphan threads, and burn tokens. So Save only writes a
  `loop_revisions` row. A Run (Mission) is created exactly once, at Office Send,
  when a user actually uses the Loop (PR-10). That send reuses the Office thread
  and writes a `loop_invocations` row — no orphan thread or run.
- **Versions are immutable.** `loop_revisions` rows are never mutated. Editing a
  Loop produces a new revision; a definition points at its current revision.
  Compiler profiles are pure: the same source prompt + profile version yields the
  same IR, so a revision is reproducible and diffable.

Current prelaunch schema tables: `loop_definitions`, `loop_revisions` (immutable),
`loop_skill_bindings`, `loop_invocations`. The first built-in compiler profile is
software-development, bundled from the fleet-development-loop assets; further
profiles (research / content / operations) register additively.

## Consequences

- Loops are reusable and versioned without coupling the saved artifact to the
  Mission engine; the IR is the contract the graph and adapter share.
- Save is side-effect-light: a revision only. The single execution boundary is
  Office Send, which keeps run/cost accounting honest and avoids orphans.
- The Mission engine is reused, not rewritten — the adapter is the only seam.
  Mission stays an internal execution-compat concept; users author Loops, not
  Missions.
- The tables live in the single current prelaunch schema baseline. Immutable
  revisions mean storage grows per edit by design (the trade for reproducibility
  and diffability).
- The graph (`2026-06-26-loop-graph-react-flow-elk.md`) is a read-only view over
  `compiled_ir_json`; positions are never written back, preserving "prompt is
  truth, not drag".
