# AICS Scene State Matrix

**Version:** v0.1  
**Status:** Implementation-facing support document  
**Audience:** rendering, runtime, UX, AI coding agents  
**Depends on:** `AICS_RUNTIME_EXPERIENCE_GDD.md`, contracts in `Docs/02_contracts_and_schemas/`

---

## 1. Purpose

This document converts the Runtime Experience GDD into a more implementation-friendly matrix.

It answers four practical questions:

1. Which runtime states matter visually?
2. What should the user see in the **world layer** (Pixi office scene)?
3. What should the user see in the **control layer** (DOM inspectors, panels, modals, toasts)?
4. How should the system degrade under reduced motion or performance pressure?

This file is **not** a replacement for product contracts or business state. It is a presentation mapping document.

---

## 2. Precedence and boundary

Use this document with the following rule:

- product and behavior truth come from PRD / Tech Stack / contracts / runtime persistence
- this matrix defines **how those truths appear** in the scene and UI
- if a contract and this matrix disagree, the contract wins

Scene feedback must be driven by explicit domain/runtime events. The client must not invent fake business state.

---

## 3. Shared vocabulary

### 3.1 Layers

- **World layer** — Pixi office scene, avatars, desks, zones, ambient feedback
- **Control layer** — DOM side panels, inspectors, install review, detail UI, logs, forms
- **Global layer** — route-level overlays, modal scrims, compatibility banners, panic/error rails

### 3.2 Performance tiers

- **Tier A / Full** — normal desktop reference environment
- **Tier B / Reduced** — reduced motion or medium GPU/CPU pressure
- **Tier C / Minimal** — severe pressure, accessibility fallback, or constrained environment

### 3.3 Motion intensity buckets

- **M0** — no motion; static emphasis only
- **M1** — subtle pulse / fade / color shift
- **M2** — moderate transform, slide, scale, or route line emphasis
- **M3** — strongest allowed runtime emphasis; reserved for failure, install, major completion, or urgent attention

---

## 4. Scene layer policy

Keep layer order stable so different systems do not fight each other.

| Layer | Role | Notes |
|---|---|---|
| L0 | floor / room base | walls, floors, partitions |
| L1 | furniture / desks / racks | static office structure |
| L2 | employee avatars / seats / devices | primary occupancy layer |
| L3 | local state accents | halos, desk glows, local progress rings |
| L4 | semantic overlays | task lines, warning tags, install candidate highlights |
| L5 | bubbles / speech / report markers | must remain readable at working zoom |
| L6 | global transient focus | spotlight, route emphasis, high-priority pulse |
| L7 | DOM overlays / modal-adjacent bridges | install review anchors, onboarding callouts |

Rule: do not let decorative effects sit above semantic overlays.

---

## 5. Event families

Scene feedback should be keyed off a small set of explicit event families.

Recommended families:

- `employee.state.changed`
- `task.state.changed`
- `task.assignment.changed`
- `meeting.state.changed`
- `install.state.changed`
- `binding.state.changed`
- `report.state.changed`
- `runtime.performance.tier.changed`
- `ui.selection.changed`

---

## 6. Employee state matrix

| State ID | Trigger source | World layer feedback | Control layer feedback | Priority | Motion | Tier B/C degradation | Exit condition |
|---|---|---|---|---:|---|---|---|
| `employee.idle` | no active task | seated avatar, calm monitor glow, neutral halo | neutral row chip / inspector state | 1 | M0-M1 | remove idle shimmer, keep static badge | task assigned / selected special state |
| `employee.assigned` | task accepted, pre-work stage | quick seat pulse or brief route line from manager/PM to employee | inspector shows new owner, queue position if relevant | 2 | M1-M2 | keep one-time highlight only | transitions to thinking/searching/executing |
| `employee.thinking` | reasoning / planning phase | soft cognitive pulse around monitor or desk | status chip + recent event line | 2 | M1 | no pulse, only status chip color/icon | tool call / search / meeting / report |
| `employee.searching` | retrieval / browse / doc scan | directional scanning sweep on desk or monitor content hint | inspector shows searching source or scope | 2 | M1-M2 | static magnifier icon and subtle label | search result / blocked / execute |
| `employee.executing` | tool call / action phase | stronger desk energy ring, route line to rack/tool wall when applicable | live action row / output stream indicator | 3 | M2 | remove route trail, keep working ring | success / blocked / failed / reporting |
| `employee.meeting` | joined meeting session | avatar emphasis shifts toward meeting room or linked meeting cluster | meeting card surfaced in side panel | 3 | M2 | no avatar movement, show cluster badge only | meeting ends / paused |
| `employee.blocked` | missing dependency, permission, or external failure | warning accent, stalled ring, amber/red local marker | inline cause, remediation CTA if possible | 5 | M2-M3 | no repeated pulse; static blocked badge | dependency cleared / retry / fail |
| `employee.waiting` | dependency wait / queued wait | low-energy queued marker, softened glow | queue position or waiting reason | 3 | M1 | static waiting dot | dependency clear / pause / cancel |
| `employee.reporting` | synthesizing output / sending result | route emphasis toward report/delivery zone, brief upward motion | report card grows in inspector | 4 | M2 | static reporting icon and card prominence | success / failed |
| `employee.success` | task or step success | short positive resolve burst, then calm settle | success line item / timestamp | 4 | M2-M3 | flash-free gentle accent only | returns to idle / next assignment |
| `employee.failed` | task or step failure | negative resolve, sharper border accent, optional seat shake kept minimal | failure summary, retry/escalate action | 5 | M2-M3 | no shake; static destructive banner | retry / rollback / idle |
| `employee.paused` | manual pause / global pause | frozen state, desaturated emphasis, pause glyph | paused rail in inspector | 4 | M0-M1 | static pause badge | resume / cancel |

Notes:

- `blocked` outranks `thinking`, `searching`, and `executing`.
- `reporting` should feel distinct from `success`; reporting is “packaging output,” not “done forever.”
- do not animate multiple primary states on the same employee simultaneously.

---

## 7. Task state matrix

| State ID | World layer signal | Control layer signal | Priority | Notes |
|---|---|---|---:|---|
| `task.created` | brief origin pulse at boss input or source desk | task row appears in queue | 1 | should be fast and not theatrical |
| `task.routed` | route line / handoff ping from boss -> manager -> owner | event log + owner update | 2 | emphasize causality, not travel realism |
| `task.queued` | small queue badge near owner or PM lane | visible queue ordering | 2 | queue must remain readable without opening logs |
| `task.active` | owner desk/employee enters active state | active chip + duration | 3 | driven by employee state |
| `task.waiting_input` | subtle help or prompt marker | explicit user-input needed state | 4 | distinct from background waiting |
| `task.waiting_dependency` | dependency line or stalled icon | dependency panel / missing prerequisite | 4 | often pairs with blocked |
| `task.review_ready` | report/delivery highlight | review card callout | 4 | use moderate emphasis, not celebration |
| `task.completed` | compact completion accent in delivery zone | completion summary | 4 | completion persists in logs, not as endless particle effect |
| `task.failed` | destructive resolve emphasis | failure panel / retry entry | 5 | tie to explicit cause |
| `task.cancelled` | fade-out or strike-through style removal | cancelled status | 3 | should feel deliberate, not like an error |

---

## 8. Meeting state matrix

| State ID | Trigger | World layer | Control layer | Priority | Notes |
|---|---|---|---|---:|---|
| `meeting.scheduled` | meeting created | room reservation tint / table readiness | meeting card appears | 2 | avoid cinematic room transitions |
| `meeting.gathering` | participants joining | route hints toward meeting room or cluster anchor | attendee roster filling | 3 | can be implied, not pathfinding-heavy |
| `meeting.active` | discussion underway | focused room glow, participant linked cluster | live agenda / transcript summary | 4 | one focal meeting at a time per local viewport |
| `meeting.waiting` | participant missing / dependency wait | amber room accent | waiting reason | 4 | should feel stalled, not broken |
| `meeting.ended` | meeting closed | quick dispersal / settle | meeting summary generated | 3 | should transition participants back to primary work state |

---

## 9. Install / import state matrix

This is one of the most important surfaces because trust matters more than spectacle.

| State ID | Contract link | World layer | Control layer | Priority | Motion | Notes |
|---|---|---|---|---:|---|---|
| `install.previewing` | pre-state | candidate asset shown as visitor/candidate silhouette or placeholder card in office-relevant zone | install review opened with source, creator, risk class, compatibility | 4 | M1 | the office may preview the asset, but truth lives in the review panel |
| `install.manifest_loaded` | manifest parsed | candidate gains richer identity / iconography | manifest fields populate | 4 | M1 | no “success” implication yet |
| `install.integrity_checked` | integrity verified | small trust accent only | checksum / signature row resolved | 4 | M1 | silent if successful is okay; loud only on failure |
| `install.compatibility_checked` | compatibility result available | environment fit marker on candidate | explicit compatibility section | 5 | M1-M2 | incompatible state must be obvious |
| `install.dependency_planned` | planner complete | dependency lines or stack markers if needed | dependency list + impact summary | 4 | M1 | show what else will be pulled in |
| `install.awaiting_bindings` | secrets/tools must be locally bound | candidate stays in holding state | binding form / unresolved requirements | 5 | M1-M2 | separate from final install confirmation |
| `install.ready_to_install` | user reviewed and can proceed | stable, confident emphasis | primary CTA enabled | 4 | M1 | should feel calm and trustworthy |
| `install.materializing` | files/entities instantiated | controlled progress emphasis in relevant zone; no magical explosion | progress / stepper / rollback safety note | 5 | M2 | strongest install motion allowed |
| `install.installed` | transaction committed | asset settles into home zone as first-class company entity | success summary + next action | 5 | M2-M3 | celebration must stay short |
| `install.failed` | transaction failed | candidate stalls or recedes, failure marker | error summary + rollback/result | 5 | M2-M3 | preserve cause and next step |
| `install.rolled_back` | rollback complete | candidate removed/returned to preview state | rollback confirmation | 5 | M1-M2 | should restore trust |
| `install.cancelled` | user aborts | fade candidate and clean temporary emphasis | cancelled notice | 3 | M0-M1 | must not look like an error |

---

## 10. Reporting / delivery matrix

| State ID | World layer | Control layer | Priority | Notes |
|---|---|---|---:|---|
| `report.drafting` | output packet forming, delivery zone soft emphasis | draft artifact shell | 3 | pairs with employee.reporting |
| `report.ready` | report zone highlight / badge | primary review card | 4 | should pull user attention appropriately |
| `report.delivered` | subtle resolve / archive settle | final artifact / share/export actions | 4 | keep post-delivery scene quiet |
| `report.rejected` | negative accent and return route to owner/PM | feedback visible, retry path explicit | 5 | should clearly reopen responsibility |

---

## 11. Global scene summary states

These are derived scene moods, not primary business states.

| Global mode | Trigger | Allowed effect | Forbidden effect |
|---|---|---|---|
| `scene.calm` | low active work | ambient subtle monitor variance | lifeless frozen office |
| `scene.busy` | multiple active employees | more concurrent local motion, slightly richer ambient density | chaotic RTS-like spam |
| `scene.attention_needed` | blocked/failure/review/install issue present | one high-priority focus rail or spotlight | flashing everything red |
| `scene.installing` | active install transaction | localized progress focus near affected zone | whole-office cinematic takeover |
| `scene.degraded` | reduced motion or performance tier drop | suppress particles, compress transitions, keep labels/trust | removing critical status truth |

---

## 12. Priority resolution rules

When multiple scene signals compete, resolve them in this order:

1. destructive/blocking states
2. install trust and compatibility states
3. report-ready / review-needed states
4. active work states
5. ambient / decorative states

Practical rules:

- one employee gets one primary state presentation
- one zone gets one dominant alert treatment
- global overlays suppress low-value ambient motion beneath them
- completion effects must never hide a simultaneous failure elsewhere

---

## 13. Reduced motion and performance fallback table

| System | Tier A / Full | Tier B / Reduced | Tier C / Minimal |
|---|---|---|---|
| avatar transition | eased move / settle | shorter move or crossfade | no move, direct snap |
| desk halo | animated pulse | slower fade pulse | static tint |
| route lines | animated draw / travel hint | fade line only | no route line |
| bubbles | animated enter/update/exit | fade + scale only | fade only |
| success/failure accents | short emphasis burst | single accent pulse | static badge |
| install materialization | stepped progress emphasis | simplified step change | progress text only |
| ambient office motion | varied micro loops | limited micro loops | off |

Reduced motion rule: preserve **state truth** even if nearly all animation is removed.

---

## 14. Suggested implementation shape

Recommended implementation split:

- `packages/core` emits domain/runtime events
- `packages/renderer` maps runtime events -> scene intents
- `apps/web` / `apps/desktop` DOM layer maps the same events -> panels, review, and logs

Avoid directly coupling raw animation code to business logic.

Suggested mapping shape:

```ts
type RuntimeSceneIntent = {
  entityId: string;
  entityType: 'employee' | 'task' | 'meeting' | 'install' | 'report';
  state: string;
  priority: number;
  motionLevel: 'M0' | 'M1' | 'M2' | 'M3';
  performanceTier: 'A' | 'B' | 'C';
  metadata?: Record<string, unknown>;
};
```

---

## 15. Out of scope for 1.0

Do not turn this matrix into permission for heavy simulation.

Out of scope:

- full pathfinding across the office
- ragdoll or physics-driven motion
- large particle systems
- audio-dependent comprehension
- cinematic camera cuts as normal workflow behavior
- procedural clutter generation that obscures state

The goal is clarity with drama, not spectacle for its own sake.
