# Offisim Animation Backlog

**Version:** v0.1  
**Status:** Implementation backlog  
**Audience:** rendering, frontend, runtime, AI coding agents  
**Depends on:** `OFFISIM_RUNTIME_EXPERIENCE_GDD.md`, `SCENE_STATE_MATRIX.md`

---

## 1. How to use this file

This backlog exists so animation and presentation work can be broken into discrete engineering tasks.

Each item includes:

- a stable ID
- priority for 1.0
- target surface
- runtime trigger
- implementation notes
- acceptance criteria

Priority legend:

- **P0** — required for 1.0 product truth
- **P1** — strongly recommended for 1.0 quality bar
- **P2** — polish after the core loop feels right
- **P3** — defer / optional / future

Surface legend:

- **WORLD** — office scene (`Three.js` 3D / `SVG` 2D)
- **DOM** — inspectors, panels, review surfaces
- **BRIDGE** — world + DOM coordinated behavior

---

## 2. Recommended implementation order

Start with this order before expanding sideways:

1. employee presence foundation
2. employee primary-state transitions
3. task handoff routing cues
4. bubbles and status anchors
5. blocked / waiting / reporting states
6. install preview + trust review flow
7. install materialization + rollback feedback
8. meeting gather / active / end flow
9. report-ready and delivery emphasis
10. reduced-motion and performance tier fallback

---

## 3. Foundation backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-001 | P0 | WORLD | Employee presence mount/unmount | employee appears in company / removed from layout | avatar, seat, and monitor elements enter and exit cleanly; no pop-in unless Tier C | employee addition/removal feels intentional and does not overlap other layers |
| ANIM-002 | P0 | WORLD | Primary employee state transition system | `employee.state.changed` | create shared transition helper for halo, icon, desk glow, and monitor hint | a state change updates all relevant visuals in one consistent sequence |
| ANIM-003 | P0 | WORLD | Bubble anchor lifecycle | task/event summary attached to employee or zone | standardized enter/update/exit behavior for semantic bubbles | bubbles do not jitter, overlap excessively, or persist after state clears |
| ANIM-004 | P0 | WORLD | Route line / handoff cue | `task.assignment.changed` / manager-to-employee handoff | lightweight route indication, not pathfinding | user can visually infer “who handed work to whom” |
| ANIM-005 | P0 | BRIDGE | Inspector ↔ scene selection sync | selection changes from scene or side panel | synchronize focus ring in world and inspector highlight in DOM | selecting either side keeps the other side in sync without jumpiness |

---

## 4. Employee and task readability backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-006 | P0 | WORLD | Idle ambient micro-motion | `employee.idle` | tiny monitor glow variance or desk activity; no toy-like fidgets | office feels alive without looking busy |
| ANIM-007 | P0 | WORLD | Thinking state pulse | `employee.thinking` | subtle cognitive pulse, low amplitude | thinking is distinguishable from idle and executing |
| ANIM-008 | P0 | WORLD | Searching state sweep | `employee.searching` | controlled scan sweep / monitor search hint | user can distinguish search from generic work |
| ANIM-009 | P0 | WORLD | Executing state emphasis | `employee.executing` | stronger local ring and/or tool-wall relationship cue | executing feels more committed than thinking/searching |
| ANIM-010 | P0 | WORLD | Blocked state alert | `employee.blocked` / `task.waiting_dependency` | amber/red emphasis, stalled ring, no aggressive flashing | blocked work is unmistakable at normal zoom |
| ANIM-011 | P1 | WORLD | Waiting / queued softness | `employee.waiting` / `task.queued` | low-energy marker and subdued motion | waiting is visible but visually quieter than blocked |
| ANIM-012 | P0 | WORLD | Reporting transition | `employee.reporting` / `report.drafting` | route emphasis toward report zone or delivery anchor | user can tell output is being packaged, not merely finished |
| ANIM-013 | P1 | WORLD | Success resolve | `employee.success` / `task.completed` | short positive accent then settle | success feels satisfying but not celebratory noise |
| ANIM-014 | P0 | WORLD | Failure resolve | `employee.failed` / `task.failed` | concise negative accent with clear stop condition | failures are visible and not confused with cancellation |
| ANIM-015 | P1 | BRIDGE | Task row ↔ world handoff echo | task state updates in queue/list | list row highlight and world cue echo each other briefly | users can follow handoffs from list to scene without hunting |

---

## 5. Meeting system backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-016 | P1 | WORLD | Meeting room readiness | `meeting.scheduled` | room table glow / reservation tint | scheduled meetings feel prepared, not spontaneous magic |
| ANIM-017 | P1 | WORLD | Participant gather cue | `meeting.gathering` | route hint or soft convergence toward meeting zone | users can tell which employees are joining a meeting |
| ANIM-018 | P1 | WORLD | Active meeting cluster | `meeting.active` | room focus, participant cluster, reduced local noise nearby | an active meeting becomes the dominant local narrative |
| ANIM-019 | P1 | WORLD | Meeting disperse | `meeting.ended` | participants return to normal work states cleanly | meeting end feels resolved, not abruptly cut |

---

## 6. Install / import trust backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-020 | P0 | BRIDGE | Install preview candidate presentation | user opens listing/install preview | show candidate asset in review and, where appropriate, as a scene visitor/placeholder | preview feels concrete without implying installation already happened |
| ANIM-021 | P0 | DOM | Manifest/integrity reveal | `install.manifest_loaded` / `install.integrity_checked` | staged review rows populate in calm sequence | trust metadata becomes readable without overwhelming the user |
| ANIM-022 | P0 | DOM | Compatibility verdict emphasis | `install.compatibility_checked` | compatibility section receives clear visual priority | incompatible assets are obvious before install is possible |
| ANIM-023 | P0 | DOM | Binding-required state | `install.awaiting_bindings` / `binding.state.changed` | keep secrets binding visually separate from install confirm | users understand that install confirmation and local binding are distinct steps |
| ANIM-024 | P0 | BRIDGE | Install materialization flow | `install.materializing` | controlled stepped progress affecting both scene and review panel | installation feels real, reversible, and grounded |
| ANIM-025 | P0 | BRIDGE | Install success settle | `install.installed` | candidate becomes installed entity and settles into home zone | newly installed asset feels like a real company capability |
| ANIM-026 | P0 | BRIDGE | Install failure + rollback | `install.failed` / `install.rolled_back` | preserve causality and trust; avoid magical disappearances | failure and rollback are understandable and reassuring |
| ANIM-027 | P1 | DOM | URL/file import feedback | file import / url import flow | provide progress, validation, and failure staging | import feels procedural and safe, not like a blind upload |

---

## 7. Report and delivery backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-028 | P1 | WORLD | Report-ready world cue | `report.ready` | report zone highlight and ownership link | user can notice deliverables without reading logs |
| ANIM-029 | P1 | DOM | Report card reveal | `report.ready` | primary report card animates into prominence without layout shift | report review feels important and stable |
| ANIM-030 | P1 | BRIDGE | Delivery confirm settle | `report.delivered` | world settles back, DOM retains artifact focus | completion closes the loop without noise |
| ANIM-031 | P1 | BRIDGE | Rejected report return path | `report.rejected` | feedback traces ownership back to PM/employee | rejection visibly reopens work |

---

## 8. Global runtime and camera backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-032 | P1 | WORLD | Scene attention router | high-priority install/block/review state | focus emphasis chooses one dominant area without taking over camera entirely | urgent states are noticeable but not disorienting |
| ANIM-033 | P2 | WORLD | Soft camera framing helper | selection / report / install contexts | optional gentle pan/fit helper for larger scenes | user orientation is preserved; no cinematic whip pans |
| ANIM-034 | P0 | WORLD | Performance tier fallback switch | `runtime.performance.tier.changed` | central kill-switches for particles, route lines, and ambient loops | visuals degrade gracefully without breaking status truth |
| ANIM-035 | P0 | WORLD | Reduced motion compliance | OS/browser/app reduced-motion setting | switch motion presets globally | product remains comprehensible with minimal motion |

---

## 9. Marketplace and trust-surface backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-036 | P1 | DOM | Listing compatibility chip interactions | listing/version detail view | subtle reveal for compatibility and risk metadata | marketplace pages stay calm while still feeling polished |
| ANIM-037 | P1 | DOM | Version switch / provenance diff reveal | package version navigation | keep transitions tight and information-first | version changes do not feel like page reload churn |
| ANIM-038 | P2 | DOM | Library install-state badges | authenticated library pages | animated badge changes on installed/update-available states | installed vs available state is easy to scan |

---

## 10. Polish / deferred backlog

| ID | Priority | Surface | Title | Trigger | Implementation notes | Acceptance criteria |
|---|---|---|---|---|---|---|
| ANIM-039 | P2 | WORLD | Department ambient identity | sustained office operation | vary ambient density by department without changing business truth | zones feel distinct but coherent |
| ANIM-040 | P2 | WORLD | Rack / tool-wall activation cue | tool/mcp interaction | brief tool-wall activation highlight | capability feels physically situated |
| ANIM-041 | P3 | WORLD | Visitor/candidate wandering preview | install candidate preview | only if it does not create false business semantics | candidate preview remains clearly “not yet installed” |
| ANIM-042 | P3 | BRIDGE | Scene-to-market crossover flourish | install from market into local runtime | only if route is trustworthy and performance-safe | adds delight without obscuring review or compatibility truth |

---

## 11. Explicit non-goals for 1.0

Do **not** schedule these unless product direction changes:

- cinematic intro sequences
- character pathfinding as a required comprehension system
- physics or crowd simulation
- mandatory sound design for state comprehension
- celebratory particle showers on every completion
- idle-game style coin / xp / reward effects

---

## 12. Suggested first engineering tickets

If you want to split immediate work for AI agents, start with these tickets:

1. `ANIM-001` + `ANIM-002` — shared employee state transition foundation
2. `ANIM-003` — bubble anchor lifecycle system
3. `ANIM-004` + `ANIM-015` — task handoff cues across world and DOM
4. `ANIM-010` + `ANIM-011` — blocked vs waiting readability
5. `ANIM-020` through `ANIM-026` — install trust flow end-to-end
6. `ANIM-034` + `ANIM-035` — performance and reduced-motion fallback

That sequence creates a working core loop before polish work begins.
