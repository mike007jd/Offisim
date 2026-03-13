# AICS Runtime Experience GDD

**Version:** v0.1  
**Status:** Working design document  
**Audience:** product, design, rendering, runtime, AI coding agents  
**Scope:** office runtime, editor-adjacent runtime feedback, install/import presentation  

---

## 1. What this document is

AICS is **not** a game product, but it needs **game-grade presentation quality**.

This document exists because the normal PRD / tech stack / UX rules are not enough to define:

- the living-office feeling
- rich state feedback across many simultaneous employees
- motion grammar for readable multi-agent work
- procedural-art boundaries
- theatrical presentation systems that make the product feel alive without adding fake gameplay systems

This is a **game-design-granularity document for a non-game product**.

---

## 2. What this document is not

This document does **not** introduce classic game systems.

AICS must **not** add:

- player level / account level
- XP bars
- rarity systems
- loot framing
- inventories / backpacks
- equipment stats
- combat loops
- idle clicker rewards
- fake resource economies
- seasonal progression clutter

The office metaphor is a comprehension tool and presentation surface.
It is **not** a progression meta-game.

---

## 3. Product fantasy

The user should feel like they are operating a **living AI company**:

- work enters through the boss
- responsibility moves across roles
- employees appear busy for understandable reasons
- rooms matter
- tools feel physically situated
- installations feel like adding real talent / capability into the company
- outcomes feel earned, visible, and inspectable

The fantasy is **operational drama**, not gamification.

---

## 4. Experience pillars

### 4.1 Alive, not noisy

The office should always feel inhabited, but never visually chaotic.

### 4.2 Readable causality

The user should be able to answer:

- who is working on what
- why they changed state
- what is blocked
- what just finished
- what needs review

without reading long logs.

### 4.3 Rich feedback, low friction

Actions should feel satisfying and high-quality, but never slow the user down.
Presentation must support control, not become spectacle for its own sake.

### 4.4 Spatial meaning

Rooms, desks, racks, and office zones are semantic.
They should help the user understand work, capability, and responsibility.

### 4.5 Trust over hype

Marketplace installs, imports, binds, and publishing flows should feel transparent,
reviewable, and reversible.

---

## 5. Core dramatic loop

The dramatic loop of the runtime is:

1. **Intent enters** — the boss issues a task or a package is introduced
2. **Responsibility forms** — manager / PM / routing logic assigns work
3. **Work becomes visible** — employees claim, queue, meet, search, execute, report
4. **State pressure appears** — waiting, blocked dependencies, missing bindings, failed steps
5. **Resolution occurs** — report, artifact, completion, rollback, retry, escalation
6. **The company changes** — new assets installed, new capabilities bound, new outputs created

This loop should be felt visually even when the user only glances at the office.

---

## 6. Real systems vs theatrical systems

AICS should only simulate deeply where the simulation creates real product value.
Elsewhere, it should use **theatrical implication**.

### 6.1 Real systems

These must map to real runtime state and persist when necessary:

- employee state
- task ownership
- queue state
- meeting state
- install/import state
- required bindings / missing permissions
- output/report state
- lineage / provenance indicators

### 6.2 Theatrical systems

These may be faked or implied as long as they remain truthful to real state:

- ambient office motion
- monitor glow and monitor content hints
- desk micro-activity
- room lighting shifts
- motion trails / attention pings
- subtle particles or pulses
- pseudo-pathing or short transitions between zones
- celebratory emphasis on completion

### 6.3 Rule

**Do not deeply simulate what can be convincingly implied.**

If a theatrical effect is used, it must still point back to a real underlying state.

---

## 7. Runtime surface model

The runtime is composed of two coordinated layers:

### 7.1 World layer (Pixi office scene)

Used for:

- office layout
- desks / rooms / racks
- employees and occupancy
- state-rich visual feedback
- spatial transitions and attention choreography

### 7.2 Control layer (DOM / product chrome)

Used for:

- boss chat / command input
- inspectors
- modals
- install review
- publishing forms
- structured reports
- detailed logs / diffs / configuration

### 7.3 Rule of responsibility

- **Canvas answers “what is happening now?”**
- **DOM answers “what exactly is this and what can I do about it?”**

Neither layer should try to fully replace the other.

---

## 8. Entity taxonomy

### 8.1 People-like entities

- Boss
- Manager
- PM
- Employees
- Visitors / candidate assets during install preview

### 8.2 Place-like entities

- desks / seats
- meeting room
- HR room
- engineering / design / marketing zones
- report room / delivery zone
- rack / slot / tool wall

### 8.3 Work-like entities

- tasks
- subtasks
- meetings
- packages / install candidates
- reports / deliverables
- warnings / blocked states

### 8.4 Infrastructure-like entities

- model profile
- MCP binding
- capability declaration
- package provenance
- compatibility status

---

## 9. Primary runtime systems

## 9.1 Employee presence system

Purpose:

Make each employee feel present, assigned, and stateful.

Core logic:

- every employee has a visible seat/home zone
- every employee always presents one primary state
- state changes trigger visual transitions, not only text updates
- off-screen or collapsed employees still keep a summarized state in surrounding UI

Minimum states:

- idle
- assigned
- thinking
- searching
- executing
- meeting
- blocked
- waiting
- reporting
- success
- failed
- paused

### 9.2 Task visibility system

Purpose:

Make work legible across multiple concurrent agents.

Core logic:

- every task has ownership
- every visible task has a current phase
- related employees can visually link to the same task
- task escalation / split / handoff should be visually understandable

Task phases:

- received
- triaged
- decomposed
- queued
- active
- awaiting_dependency
- awaiting_review
- reporting
- completed
- failed
- cancelled

### 9.3 Meeting system

Purpose:

Represent coordination events without forcing the user to read transcripts first.

Core logic:

- meetings are visible as temporary convergence events
- a meeting should feel denser and more focused than normal work
- interruption, resolution, and post-meeting redistribution should be obvious

Feedback markers:

- participants converge or visually focus on a shared location
- room or area gains a denser “active coordination” treatment
- after meeting ends, ownership flows back out to participants

### 9.4 Install / import system

Purpose:

Make new assets feel like real additions to the company, while keeping trust high.

Core logic:

- install is a staged process, not a single button flash
- each stage should be human-readable
- missing bindings or incompatibility are first-class visible states
- installation changes the company surface in a visible way

Install phases:

- source selected
- manifest loaded
- integrity checked
- compatibility checked
- dependency planned
- review required
- bindings required
- materializing
- installed
- failed
- rolled back

### 9.5 Reporting / delivery system

Purpose:

Reward completion with clarity and closure.

Core logic:

- outputs should leave a visible trace in the office
- reporting should feel like a handback, not just a toast
- final state should be inspectable

---

## 10. Visual feedback grammar

The office needs a stable grammar so that many simultaneous events remain readable.

### 10.1 Feedback channels

Use these channels in combination:

- pose / posture change
- icon / badge change
- state ring or aura
- bubble / label change
- local motion pattern
- link line / ownership line
- room emphasis
- inspector update
- timeline / log event
- optional sound later (not required for 1.0)

### 10.2 Priority order

When many states compete, prioritize in this order:

1. destructive / failure / blocked
2. install risk / binding required / incompatible
3. currently active work
4. meeting / coordination event
5. newly completed work
6. ambient presence

### 10.3 Signal composition rule

No important state should rely on only one signal.

Every critical state should combine at least two of:

- color/status token
- icon or label
- motion or pulse pattern
- inspector/log explanation

---

## 11. Employee state choreography

### 11.1 Idle

Visual intent:

Present, calm, available.

Suggested feedback:

- low-amplitude breathing / monitor idle flicker
- neutral desk lighting
- no urgency pulse

### 11.2 Assigned / thinking

Visual intent:

A task has arrived and is being digested.

Suggested feedback:

- subtle focus pulse around seat
- incoming task bubble appears then settles
- employee posture shifts from idle to engaged

### 11.3 Searching / researching

Visual intent:

The employee is gathering information.

Suggested feedback:

- light scan / ripple motif
- transient mini-nodes / notes / browser-like flickers
- moderate motion, not frantic motion

### 11.4 Executing

Visual intent:

Work is actively being produced.

Suggested feedback:

- stronger desk activity
- denser monitor animation
- active state ring
- local throughput pulses toward output direction

### 11.5 Meeting

Visual intent:

Multiple roles are coordinating.

Suggested feedback:

- participant emphasis moves to meeting room or shared locus
- coordinated pulse shared across participants
- reduced unrelated ambient motion nearby

### 11.6 Blocked / waiting

Visual intent:

Progress is halted for a reason.

Suggested feedback:

- activity decays instead of abruptly disappearing
- blocked icon / dependency marker becomes primary signal
- line toward missing dependency or required binding when useful

### 11.7 Reporting

Visual intent:

The employee is packaging or handing back work.

Suggested feedback:

- output packet / report envelope / delivery pulse
- path or ownership line shifts back toward manager/boss/report room

### 11.8 Success

Visual intent:

Closure, not fireworks.

Suggested feedback:

- short controlled affirmation burst
- state settles to completed marker then returns to calm
- completion remains inspectable in DOM

### 11.9 Failed

Visual intent:

Clear failure with cause and next step.

Suggested feedback:

- failed state pulse is sharper and shorter than success
- desk and task markers indicate stall
- inspector/log immediately expose reason and recovery path

---

## 12. Install / import presentation system

Install/import is one of the most important “high drama” moments in AICS.
It should feel serious, trustworthy, and satisfying.

### 12.1 Install UX principles

- never look magical or hidden
- never look like a package manager console dump by default
- never hide binding requirements until after installation
- never imply execution before the user approves

### 12.2 Install preview stage

User should see:

- package identity
- asset kind
- version
- creator / provenance
- declared capabilities
- required bindings
- environment compatibility
- what will be added / changed

### 12.3 Materialization stage

When install begins, the package should feel like it is entering the company.

Possible presentation:

- candidate card or package token enters from import tray / inbox zone
- validation gates illuminate in order
- on success, the asset resolves into employee / SOP / template / company object
- on failure, the object is halted before final placement

### 12.4 Binding-required stage

This should feel explicit and safe.

Presentation:

- asset is present as a pending shell / placeholder
- unresolved bindings are visibly marked
- install is not “complete” until the user resolves or intentionally skips allowed bindings

### 12.5 Rollback stage

Rollback should not feel like silent disappearance.

Presentation:

- show that the attempted materialization is being reversed
- preserve error / reason in timeline and inspector
- restore company state with visible confidence

---

## 13. Procedural art direction

The office should use **program art** / procedural art wherever possible,
not as a cheap fallback but as a coherent style choice.

### 13.1 Art system: Modular Paper Doll Puppet

**All characters (employees + lobster/OpenClaw agents) use a modular puppet system.**

The puppet system draws characters from composable body parts using PixiJS Graphics API,
with each part as a Container with a pivot point (joint). Animation is driven by GSAP
timelines manipulating joint rotations, positions, and scales.

This approach was chosen because:

- LLM/AI code generates geometric shapes well (circles, rounded rects, bezier curves)
- LLM/AI code generates pixel art poorly (requires exact pixel placement)
- SVG/vector primitives are text-representable → AI can iterate on them
- Color customization is trivial (change fill parameters)
- Skeletal animation reuses one rig across many appearances

#### 13.1.1 Character style: Q-version (Chibi)

- head:body ratio ≈ 1:1 to 1:1.2
- simplified joints (no elbows/knees — upper limbs connect directly to hands/feet)
- exaggerated expressions and gestures
- readable at small scene scale (20-40px logical height)
- stylized, not cartoonish — soft industrial / productive aesthetic

#### 13.1.2 Employee puppet anatomy

```
CharacterPuppet extends Container
├─ head (Container, pivot: neck)
│   ├─ face (Graphics - circle/oval, skinColor)
│   ├─ eyes (Graphics - dots/ovals, state-reactive)
│   ├─ hair (Graphics - shape varies by hairStyle, hairColor)
│   └─ mouth (Graphics - expression changes by state)
├─ body (Container)
│   ├─ torso (Graphics - rounded rect, clothingColor)
│   └─ arms × 2 (Container, pivot: shoulder)
│       ├─ upperArm (Graphics, skinColor)
│       └─ hand (Graphics, skinColor)
└─ legs × 2 (Container, pivot: hip)
    ├─ thigh (Graphics, clothingColor)
    └─ foot (Graphics)
```

#### 13.1.3 Lobster puppet anatomy (OpenClaw agents)

```
LobsterPuppet extends Container
├─ body (oval carapace, brandColor)
├─ claws × 2 (Container, pivot: shoulder joint)
│   ├─ arm (Graphics)
│   └─ pincer (Graphics, open/close rotation)
├─ antennae × 2 (Container, sway animation)
├─ legs × 6 (Container, walking cycle)
├─ tail (fan shape, bounce)
└─ eyes × 2 (on stalks, lookAt rotation)
```

#### 13.1.4 Character customization (CharacterConfig)

```
CharacterConfig {
  skinColor: hex       — skin tone
  hairColor: hex       — hair color
  hairStyle: enum      — short | long | ponytail | curly | bald | bob | spiky | braids
  clothingColor: hex   — primary clothing color
  clothingAccent: hex  — secondary clothing color
  bodyType: enum       — normal | slim | stocky
  gender: enum         — neutral | masculine | feminine
}
```

The employee creation wizard generates a CharacterConfig.
Each config produces a visually unique puppet sharing the same animation rig.

#### 13.1.5 Animation states (shared across employee + lobster puppets)

| State | Key motion | Loop? |
|-------|-----------|-------|
| idle | micro-breathing (Y amplitude), blink, subtle hand sway | loop |
| walking | leg alternation, arm swing, body bob | loop |
| sitting | legs bent, hands on desk, slight forward lean | static+breathing |
| working | sitting + typing motion (arm micro-oscillation) | loop |
| thinking | hand on chin, slow head tilt, slow blink | loop |
| talking | mouth open/close, gesture arms | loop |
| resting | body leaned back, eyes half-closed, arms down | loop |
| searching | hand shading eyes, body slight turn | loop |
| reporting | holding document, facing camera | static |
| excited | jump bounce, arms raised | play-once |
| blocked | body slump, hand on forehead, red overlay | static |
| success | arms up celebration, green flash | play-once |
| failed | head down, shoulders slumped | static |
| paused | frozen pose, grey desaturation | static |

Each state = one GSAP Timeline operating on joint rotations/positions.
State transitions use crossfade (kill old timeline, start new with ease-in).

### 13.2 Why procedural art fits AICS

- it scales with generated/installed assets
- it keeps the runtime responsive to live state
- it supports local-first customization
- it avoids needing handcrafted art for every employee/package variation
- puppet rigs animate without sprite sheets or external art tools

### 13.3 Procedural art targets

Good candidates for procedural generation:

- **employee puppets** — modular body parts, color-customizable
- **lobster puppets** — OpenClaw agent brand representation
- desk props and furniture (geometric shapes)
- screen content hints
- room accents and zone decorations (bookshelves, sofas, plants)
- company theme variants
- package materialization effects
- state rings / pulses / badges
- simple report artifact treatments

### 13.4 Procedural art limits

Do not generate art that creates noise or undermines legibility.

Avoid:

- extremely detailed animated clutter
- random decoration with no semantic meaning
- visually unique effects for every single asset without category rules
- heavy shader tricks that hurt readability or performance
- pixel art (AI generates it poorly; use vector/geometric primitives instead)

### 13.5 Style direction

Recommended aesthetic:

- crisp 2D vector / geometric primitives
- Q-version (chibi) character proportions
- soft industrial / productive / operational palette
- readable from zoomed-out overview and mid zoom
- limited palette variance with semantic accents
- color-differentiated department zones

---

## 14. Motion system

### 14.1 Motion roles

Use motion for:

- state change confirmation
- ownership transfer
- task continuity
- install trust and staging
- focus guidance
- resolution / closure

Do not use motion for empty decoration.

### 14.2 Motion scales

#### Micro motion

Used for:

- hover feedback
- desk breathing
- tiny status pulses
- monitor flickers

#### Meso motion

Used for:

- employee state transitions
- task bubble changes
- short ownership line changes
- install stage progression

#### Macro motion

Used for:

- meeting convergence
- report handback emphasis
- package materialization
- camera/focus shifts if used

### 14.3 Motion style

- quick settle
- clean ease-out
- low overshoot by default
- avoid bouncy toy-like motion
- avoid long floaty cinematic transitions

### 14.4 Reduced motion behavior

When reduced motion is enabled:

- remove ambient loops where possible
- preserve state clarity through iconography, labels, and color tokens
- shorten or replace choreographed transitions with fades / instant changes

---

## 15. Camera and framing rules

If camera movement exists, it must support comprehension.

### 15.1 Default view

The user should generally maintain a stable office overview.

### 15.2 Focus events

Camera or viewport emphasis may be used for:

- selected employee
- active install review
- meeting start
- critical failure
- report handoff

### 15.3 Guardrails

- do not constantly auto-pan the user away from their work
- do not turn the office into a cinematic spectator mode
- focus assists must be interruptible and short

---

## 16. Scene event model

The renderer should subscribe to explicit runtime/domain events.

### 16.1 Core event families

Suggested event families:

- `employee.created`
- `employee.state.changed`
- `employee.binding.changed`
- `task.created`
- `task.phase.changed`
- `task.owner.changed`
- `meeting.started`
- `meeting.updated`
- `meeting.ended`
- `install.started`
- `install.phase.changed`
- `install.binding_required`
- `install.completed`
- `install.failed`
- `report.created`
- `report.delivered`
- `runtime.alert`

### 16.2 Event design rule

The renderer must not invent business state.

It may derive:

- visual emphasis
- grouping
- timing
- secondary ambient effects

But source-of-truth state comes from runtime/domain events.

---

## 17. Feedback matrix

| Situation | Canvas feedback | DOM feedback | Persistence expectation |
|---|---|---|---|
| Employee assigned | seat pulse, task bubble arrival | inspector ownership update | transient + event log |
| Employee blocked | blocked marker, decayed activity, dependency emphasis | inline reason + recovery action | persistent until resolved |
| Meeting starts | participant emphasis, room activation | meeting panel/timeline | persistent during meeting |
| Install review required | candidate object parked in pending zone | review sheet/modal | persistent until decision |
| Binding required | unresolved shell markers | binding checklist | persistent until resolved/skipped |
| Install success | materialization settle, short affirmation | installed summary | persistent install record |
| Install failure | halted materialization, failure pulse | error surface + rollback state | persistent failure record |
| Report delivered | delivery pulse to report locus | report card/result panel | persistent deliverable |

---

## 18. Performance strategy

AICS should feel rich, not expensive.

### 18.1 Budgeting principle

Always design a **graceful degradation path**.

When pressure rises, reduce in this order:

1. ambient decoration
2. secondary particles / flourishes
3. long-lived local effects
4. fine-grained desk detail
5. only then consider reducing core state clarity

### 18.2 Performance rules

- critical state markers must survive low-performance mode
- decorative effects must be removable without breaking comprehension
- avoid creating unique expensive animation graphs for every employee
- prefer shared effect templates driven by state tokens
- use zoom-aware detail levels

### 18.3 Truthful richness

The user should never need 200 simultaneous expensive effects to perceive “a living company.”
Careful staging beats brute-force animation.

---

## 19. Accessibility and clarity

### 19.1 Non-color rule

Critical state cannot rely on color alone.

### 19.2 Parallel path rule

If a scene interaction is important, there should be a parallel control path in DOM where practical.

### 19.3 Dense-state rule

At high office density, aggregate and summarize rather than stacking unreadable signals.

---

## 20. What 1.0 must include

Minimum 1.0 presentation systems:

- employee state choreography
- task phase feedback
- meeting emphasis
- install/import staged presentation
- visible blocked / failed / binding-required states
- report delivery feedback
- procedural avatar / desk / package style system
- zoom-aware scene clarity
- reduced-motion mode
- graceful low-performance mode

---

## 21. What 1.0 should avoid

Avoid in 1.0:

- full pathfinding-heavy office simulation
- physics-heavy interactions
- deep life-sim NPC schedules
- voice / lipsync dependencies
- hyper-custom one-off effects per asset type
- flashy cinematic camera systems
- reward fireworks that feel gamified

---

## 22. Success criteria

This document is successful when the product feels:

- alive without feeling gamified
- rich without feeling noisy
- trustworthy during install/import/publish moments
- readable during multi-agent concurrency
- distinct from both dashboard SaaS and toy office games

If a user says:

> “I can understand what my company is doing at a glance, and it feels amazing to watch.”

then this system is working.

---

## 23. Implementation note for AI coding agents

When implementing office-scene changes:

1. identify the real domain event or state first
2. define the presentation layer that maps to it
3. choose the minimum effect set that makes the state obvious
4. ensure reduced-motion and low-performance fallback
5. keep DOM and canvas responsibilities separate

Do not start from “what animation would look cool.”
Start from “what operational truth needs to become visible.”

---

## 24. Known implementation gap

This document defines presentation intent and system logic,
but it is **not yet sufficient on its own** to drive fully deterministic implementation.

Before large-scale scene production, add:

- a scene state matrix (`state × entity × signal × priority`)
- an animation backlog with canonical effect names and timing ranges
- a renderer layering/z-index policy
- low-performance fallback tables per effect family
- install/import review wireframes for DOM surfaces

AI coding agents should treat this file as the **experience design source**,
not as a substitute for concrete state matrices or animation tickets.
