# Loop graph visualization: React Flow + ELK

Checked at: 2026-06-26 NZST
Status: accepted (PR-09, Loops nested-loop graph)
Scope: adds two renderer dependencies and a read-only `LoopGraphPanel`. Does
**not** change the Loop DB, compiler, IR contract (PR-07), the Office composer,
or the overall Loops editor page (PR-08). The panel is a pure VIEW over `LoopIR`.

## Why a new framework needs an ADR

`AGENTS.md` and `Docs/UI_FRAMEWORK_STACK.md` freeze the approved renderer stack
(React 19, Tailwind v4, shadcn/ui, assistant-ui, Motion, lucide-react, TanStack
Query/Virtual, Zustand, RHF+Zod, dnd-kit, react-resizable-panels, cmdk, Sonner,
Recharts). There is **no graph-canvas or graph-layout library** in that list.
PR-09 needs both, so this ADR records the decision, the exact versions, and the
constraints that keep the addition safe.

## Chosen libraries + exact versions

| Library | Purpose | Version (pinned) | checkedAt |
|---|---|---|---|
| `@xyflow/react` (React Flow) | React graph canvas: nodes/edges, custom node types, viewport, pan/zoom, controls, minimap, selection, fit-view | `^12.11.1` | 2026-06-26 |
| `elkjs` (Eclipse Layout Kernel, JS) | Hierarchical / compound auto-layout: `layered` algorithm, orthogonal edge routing, hierarchy handling, deterministic positions | `^0.11.1` | 2026-06-26 |

Versions verified with `npm view @xyflow/react version` → `12.11.1` and
`npm view elkjs version` → `0.11.1` on 2026-06-26. Caret ranges are pinned in
`apps/desktop/renderer/package.json`; `pnpm install` updated the lockfile.

## Why React Flow + ELK fit Loops

A Loop is a *generic cyclic graph IR* (`packages/shared-types/src/loops/ir.ts`),
not a linear flowchart. The view layer has to express:

- **Cycles and feedback edges** — `feedback` / `retry` / `escalate` edge kinds
  loop back to earlier nodes. A node-based canvas renders these as first-class
  directed edges with distinct line/badge grammar; static prose cannot.
- **Nested subloops** — a `subloop` node references an inline `childGraph` or a
  saved revision. React Flow models parent/child via compound nodes; ELK lays
  out compound hierarchies natively (a big loop containing small loops).
- **Drilldown + breadcrumb** — entering a subloop swaps the rendered subset to
  the child graph while the full projection stays in memory. React Flow only
  renders the node set you hand it, so drilldown is "hand it a different slice".
- **Expand/collapse** — show only the visible subset at the current level; the
  full graph is retained in the domain projection, never lost.
- **Large viewport** — pan/zoom/fit-view/minimap come for free, so a 250-node /
  500-edge IR stays usable through collapse and drilldown.
- **Deterministic layout** — ELK with a fixed algorithm + stable input order +
  fixed `randomSeed` produces the same positions for the same IR (no jitter on
  re-render). Selection never re-runs layout.

React Flow handles *interaction and rendering*; ELK handles *placement*. We do
not hand-roll viewport, edge routing, selection, or accessibility primitives.

## Constraints (the part that keeps this safe)

- **React Flow Pro examples are INSPIRATION ONLY.** The expand/collapse and
  subflow-drilldown interaction ideas are informed by Pro examples, but **no
  Pro-licensed source is copied**. Everything in `loops/graph/**` is implemented
  against the open-source `@xyflow/react` + `elkjs` public APIs.
- **DB stores `LoopIR`, never React Flow `Node[]`/`Edge[]`.** The immutable
  `loop_revisions.compiled_ir_json` is the business truth. The adapter
  (`loop-graph-adapter.ts`) projects IR → a `LoopGraphProjection`; the layout
  step (`loop-graph-layout.ts`) computes positions in memory. ELK positions are
  cached in memory only and are **never written back** to the revision (no
  drag-truth, no pinned-position storage in phase 1).
- **No direct business-step editing on the graph.** The graph is read-only /
  drilldown. Editing a Loop happens by prompt / Enhance / recompile (PR-08).
  This intentionally avoids a "prompt truth vs. drag truth" two-way sync
  conflict — see `RESEARCH_AND_PRODUCT_DECISIONS.md` §3.
- **Phase 1 = NL-driven, graph read-only/drilldown.** Pinning node positions
  back into the revision is a deliberate future option, gated behind a real
  product decision, not a default.
- **Public surface is `LoopGraphPanel` only.** PR-08 integrates through the
  documented props (`ir`, `selectedNodeId`, `onSelectedNodeChange`,
  `onNavigatePathChange`, `state`, `findings`). PR-08 does not touch React Flow
  internals or the adapter directly.

## Alternatives considered (and rejected)

- **Mermaid** — great for static docs / read-only diagrams, weak as a primary
  interactive drilldown canvas (no real selection model, no compound layout
  control, no viewport API). Rejected.
- **Cytoscape.js** — strong for graph analysis/algorithms, but heavier to wire
  into a React UI and oriented at analysis rather than productized hierarchical
  flow interaction. React Flow sits closer to the existing React renderer.
- **Hand-rolled SVG/canvas** — would re-invent viewport, selection, edge
  routing, and accessibility. Rejected as wheel-reinvention.

## Testability

The adapter + layout are pure and DOM-free: `scripts/harness-loop-graph-projection.mts`
runs ELK headlessly via `elkjs/lib/elk.bundled.js` (worker-less constructor) and
asserts the projection + layout result without a React Flow / browser runtime.
The harness is wired into `pnpm validate`. The React layer (`LoopGraphPanel`,
node/edge components) is the only part that needs a live `.app` for visual /
interaction verification.
