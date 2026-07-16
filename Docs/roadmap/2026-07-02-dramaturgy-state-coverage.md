# Dramaturgy Required-State Coverage Matrix (I7)

> **Historical / superseded (2026-07-16):** point-in-time coverage matrix. Use
> the [current Codex-alignment tasks](./2026-07-13-ui-ux-consistency-pass/tasks.md),
> [feature catalog](../FEATURES.md), and current Office harnesses for acceptance.

Deterministic harness evidence for every state in the PRD "Required State
Coverage" list (`2026-07-02-production-work-dramaturgy-prd.md`). Each state is
covered by at least one check that drives the REAL pipeline (`composeBeats` /
`projectEmployeeWorkloads` / `projectSceneCues` / `projectOfficeStaging` /
clip-map) and asserts the state's observable contract. Coverage is generic —
no per-profession logic anywhere in the fixtures or assertions.

Harness-only by design (PRD Verification Plan): the exact **58-run tier** and
the **resource-exhausted blocked kinds** (token/budget/context/runtime — and
`budget`/`context` in particular) are structurally unreachable or
nondeterministic in a release build (live delegation caps one run tree at 16
children / 4 parallel). Deterministic harness evidence is the sanctioned form
for those states; the I8 live pass must not chase them with real model runs.

Check counts after I7: scene-cue **87**, beat-composer **69**,
office-projection **50**, workload-chips **25**, dramaturgy-modes **16**,
dramaturgy-stress **13**, conversation-run-controller **17 scenarios**,
character-clip-map **17 280-state enumeration + 16 semantic anchors + 21-clip
reachability ledger**.

Check names below match each harness's per-check output lines verbatim, with
one exception: `character-clip-map` prints a single PASS summary on success —
its anchor labels (e.g. `approval wait`) appear in the harness source and
print only on failure.

| State | Harness | Check name(s) |
|---|---|---|
| idle employee | scene-cue | `never-messaged roster hire still gets an actor cue` · `idle hire rests: no thread, not running, idle bubble, no artifacts` |
| selected employee | scene-cue | `actor running + selected via employee selection` · `attention follows the selected thread (no severe issue)` · `selected actor still reads selected (attention is a separate cue)` |
| hovered employee | scene-cue | `hoveredEmployeeId → ActorCue.hovered true (selected/dragging stay false)` · `hover is not an attention arm (nothing severe/selected/delivered → attention null)` |
| dragged employee (3D-only input) | scene-cue | `draggingEmployeeId → ActorCue.dragging true (3D drag input; 2D omits the source)` · `hover/drag of an unknown id decorates nobody (exact employee match only)` · degradation: `all selected/hovered/dragging are exactly false` |
| one active run (×1 = NO countLabel) | scene-cue · office-projection · workload-chips | `one active run → NO ×N badge (countLabel null) and the count leads` · `1 active run → activeCount 1` · `acceptance: 1 run → tier small, no ×N badge` · `1 run → countLabel null` |
| three active runs | office-projection · workload-chips | `3 members → activeCount 3` · `acceptance: 3 runs → tier small, ×3, ≤3 chips` · `3 runs → countLabel ×3` |
| 58 active runs (harness-only) | scene-cue · office-projection · workload-chips | `58 active runs → tier 'large', ×58` · `exactly 4 grouped chips (fixed bubble dims)` · `flows stay within the noise cap (≤8 signal beats total)` · `58 children still ONE fan-out cue` · `58 members → summary.total 58` (+ byWorkKind/byStatus partition sums) · `acceptance: 58 runs → one actor, ×58, tier large` · `58 runs → exactly 4 chips (fixed dims)` |
| planning | office-projection | `planning: plan beat (phase 'plan') presents at the board with write-board + thinking` |
| reading/searching | beat-composer · office-projection | `reading: read tool → research beat, phase 'read', reading-seat, document prop` · `searching: search tool → research beat, phase 'read', activityKind 'search'` · `10 read/search tools → 1 research beat (not 10)` · `researcher (research) does NOT relocate` · `researcher performance is read` |
| writing/editing | beat-composer · office-projection | `writing: write tool → produce beat, phase 'produce', workstation, laptop prop` · `editing: edit tool → produce beat, phase 'produce', activityKind 'edit'` · `worker (produce) does NOT relocate` · `worker performance is type (produce/write)` |
| shell/build/test/compute | beat-composer · office-projection | `shell: shell tool → compute beat, phase 'compute', server-inspect, terminal prop, tool route` · `build/test: both stage compute beats (phase 'compute') with their own activityKind` · `long compute → exactly 2 beats (micro + 1 relocate)` · `compute: shell beat (phase 'compute') stays in place with inspect-terminal + terminal prop` · phase distinctness: `the three activity families are pairwise distinct phases (read/produce/compute)` |
| reviewing | office-projection | `reviewing: review beat (phase 'review') relocates to standing review with annotate + discuss` |
| delegating | beat-composer · office-projection · scene-cue | `3 delegate beats` · `first child not flagged parallel` / `second/third children flagged parallel` · `delegate beat moves` · `mover (delegate) relocates` · `fan-out bundles per (target, kind), not one line per child` |
| joining/fan-in | beat-composer · office-projection · scene-cue | `join beat is kept (not dropped)` · `join within 8s downgraded to in-place (no movement)` · `finisher (join) relocates` · `child completion joins toward review as 'fan-in'` |
| waiting for approval | beat-composer · office-projection · scene-cue · conversation-run-controller · clip-map | `approval is an amber wait signal, not a blocked permission resource` · `approval priority is 100` / `approval is an interrupt` · `waiter (approval) reacts in place` · `waiter performance is approval-wait + clipboard (distinct from blocked)` · `approvalCount reflects the 2 awaiting-approval members` · `approval → 'user' target + 'approval' ink` · scenario `confirm approval rejects stale answers and resolves the live answer` · anchor `approval wait` (approval.wait) |
| producing an artifact | beat-composer | `artifact beat carries an artifact intent` · `artifact beat flows to delivery` · `produce beats = 2 (write micro + artifact milestone)` · `artifact.created with payload.path → beat.artifact.path equals payload.path` |
| artifact delivered and claimable | scene-cue (+ harness-artifact-claim for open targets) | `5 artifacts → 3 chips` · `recentCount 5, overflowCount 2` · `latest is the newest artifact (A5)` · `chips carry the owning employeeId (the scenes route history by owner, not threadId)` · `global shelf carries every owner-resolvable claim (a child run's artifact never vanishes)` |
| tool failed | beat-composer · scene-cue | `failureKind 'tool' → {tool, blocked, 'tool failed'}` · `tool failure and run failure both stage failure beats` · `failureKind 'tool' → ResourceCue {tool, blocked}, glyph 'X', issue leads the bubble` |
| token exhausted (harness-only) | beat-composer · scene-cue | `failureKind 'token' → {token, exhausted, 'token exhausted'}` · `run.failed failureKind 'token' → ResourceCue {token, exhausted}` · `root 429 surfaces as {token, exhausted} on the resource cue` · `renderer classifier types the live 429 message as 'token'` |
| budget exhausted (harness-only) | beat-composer · scene-cue | `failureKind 'budget' → {budget, exhausted, 'budget exhausted'}` · `failureKind 'budget' → ResourceCue {budget, exhausted}, glyph 'B', issue leads the bubble` |
| permission blocked | beat-composer · scene-cue | `failureKind 'permission' → {permission, blocked, 'permission blocked'}` · `failureKind 'permission' → ResourceCue {permission, blocked}, glyph 'P', issue leads the bubble` |
| context blocked (harness-only) | beat-composer · scene-cue | `failureKind 'context' → {context, blocked, 'context blocked'}` · `failureKind 'context' → ResourceCue {context, blocked}, glyph 'C', issue leads the bubble` |
| runtime blocked (harness-only) | beat-composer · scene-cue · conversation-run-controller | `failureKind 'runtime' → {runtime, blocked, 'runtime blocked'}` · `failureKind 'runtime' → ResourceCue {runtime, blocked}, glyph 'R', issue leads the bubble` · scenario `delegation records retain workKind and typed failureKind` |
| six-kind marker vocabulary (shared) | scene-cue · beat-composer | `RESOURCE_KIND_GLYPHS covers exactly the six resource kinds` · `six single-character glyphs, all distinct (T/B/P/C/R/X)` · `failed run without failureKind → generic {tool, blocked, 'run blocked'} (summary ignored)` · `out-of-vocabulary failureKind → generic marker (never a missing resource)` |
| cancelled run (neutral) | beat-composer · scene-cue · office-projection | `run.cancelled stages a cancelled beat (not a failure beat)` · `cancelled beat carries NO resource intent` / `NO failure flow` · `cancelled visual is neutral (no blocked phase/emotion, no risk badge)` · `cancelled run → NO resource cue` · `cancelled beat emits no flow signal` · `cancelled: actor rests in the neutral IDLE performance (no celebration, no worry, no staging)` |
| completed run | beat-composer · office-projection · conversation-run-controller · clip-map | `root run.completed stages a complete beat (not a join)` · `complete visual celebrates: phase 'complete', emotion 'celebrating', package prop` · `complete flows to delivery and presents at the board (movement beat)` · `complete carries no resource marker (celebration, not risk)` · `completed: complete beat (phase 'complete') celebrates — happy + point at the board, delivery flow` · scenario `office success with attachment, reasoning, content and persistence` · anchor `peak completion dances` (celebrate.dance) |
| reduced-motion mode | dramaturgy-modes · scene-cue | `reduced-motion: nobody relocates (even cinematic)` · `reduced motion clears staging, keeps performance` · (`focus mode clears staging too`) |
| no-live-beat active run fallback | scene-cue · office-projection · conversation-run-controller | `beatless active run still yields a running actor cue` · `beatless run still shows a generic 'Work' chip (never an empty bubble)` · `no live beat → unstaged: null performance, no staging (scene keeps its idle pose path)` · `beatless frame carries no flow/resource noise` · `no-live-beat member → unclassified byWorkKind (=1)` · scenario `same employee concurrent runs aggregate to one actor with activeCount` (chips `['Work','Work']`) |
| terminal failed child visible while issue live | office-projection · scene-cue · workload-chips | `failed-with-live-beat: priorityIssue present with terminal true` · `terminal failed member does NOT become dominant over an active sibling` · `terminal-root failed child with live beat still projects an employee entry` (survives the root finishing) · `failed-without-beat: dropped from the rollup (total 1)` (issue-liveness bound) · `terminal failed child stays visible without inflating activeCount` · `terminal-only → synthesizes a risk chip from the top issue` |
| terminal failed ROOT visible while issue live | scene-cue | `failed root run keeps its employee on the board (terminal issue member)` · `root failure: no active concurrency, issue takes the primary slot` · `root 429 surfaces as {token, exhausted} on the resource cue` |
| character states (work/wait/blocked/routine/celebrate + totality) | character-clip-map | full 17 280-state totality + determinism enumeration over 21 shipped clips · anchors include `seated typing` (sit.type) · `approval wait` (approval.wait) · `worried folds arms` (wait.foldarms) · `blocked shakes head` (blocked.headshake) · `peak completion dances` (celebrate.dance) · reserved `phone` / `consume` routines · complete reachability ledger |

Cross-cutting locks that keep the matrix honest: scene-cue determinism
(`two identical invocations → byte-identical frames`, reversed-beat-order
identity, base/input split equivalence), dramaturgy-modes truth preservation
(`focus: actor set + performance preserved`), and dramaturgy-stress high-load
integrity (no anchor double-booking, walker cap, per-frame budget).
