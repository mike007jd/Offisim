# Project Constitution

This repository follows an AI-first, full-speed development workflow.

We are AI-driven development. What used to take teams weeks takes us hours.
Do not think in phases, sprints, or multi-week roadmaps.
Think in sessions: one session, one production-ready deliverable.

## AI Development Manifesto

1. **Ship 1.0, not 0.1.** Every build targets production-grade completeness.
   No "MVP scaffolding to polish later". No throwaway prototypes. Build it right, build it once.
2. **No multi-phase fantasies.** There is no Phase 1 / Phase 2 / Phase 3.
   There is only: build the complete thing now. If it's too big for one session, split by feature boundary, not by quality tier.
3. **Go wide and deep in one pass.** AI can generate full features end-to-end.
   Do not artificially constrain scope. If you can build the complete feature now, do it.
4. **Speed is the default.** Do not hedge, do not add "we might need this later" abstractions.
   Build exactly what is needed, at production quality, right now.
5. **Validate as you go, not at the end.** But do not let validation become a bottleneck — fix and move on immediately.

## Non-negotiable principles

1. Build production-grade from the first meaningful implementation.
   Do not intentionally ship throwaway scaffolding with the plan to “redo it later.”
2. Offisim is local-first.
   The user’s company runtime belongs on their machine or self-hosted environment, not in an accidental SaaS control plane.
3. Multi-agent collaboration is the core product primitive.
   Routing, handoffs, meetings, interrupts, queueing, resume, and reporting are first-class.
4. Model choice belongs to the user.
   Do not hardwire provider assumptions into marketplace assets.
5. Packages must be declarative, reviewable, and reversible.
   1.0 forbids install hooks, postinstall scripts, hidden shell execution, and embedded secrets.
6. Permissions follow least privilege.
   Capabilities are exposed through seats / bindings / declared requirements, not hidden side channels.
7. Listings, package versions, and installed instances are different lifecycle objects.
   Do not collapse them into one shortcut abstraction.
8. Desktop is the 1.0 reference environment.
   Web experiences must respect browser constraints instead of pretending they do not exist.
9. Prefer readable, boring code over clever architecture.
10. Reuse before inventing new abstractions.
11. Validate continuously.
12. Do not widen scope without a concrete reason.

## Product guardrails

- The office metaphor is a comprehension aid, not a game system.
- Do not introduce progression mechanics, rarity systems, or gamified clutter.
- The marketplace is a registry and trust surface; it is not the primary execution plane.
- Employees may carry recommended model profiles; other asset types should remain model-agnostic by default.
- Game-grade presentation is allowed only when it improves operational clarity, trust, or spatial readability.
  It must not create fake gameplay systems.

## Delivery rules

A task is not done when it “basically works.”
A task is done when the affected surface is coherent, understandable, testable, and validated.

Minimum completion standard:

- code is understandable
- design and UX rules are respected
- lint passes
- typecheck passes
- build passes
- relevant tests pass
- touched contracts are updated when behavior changed

## Decision rules

When a decision is ambiguous:

- choose the simpler implementation
- choose the option that preserves declared architecture boundaries
- choose the path that creates less future cleanup
- choose reuse only when it is real and immediate
- avoid speculative abstractions

## Planning rule

Plan by feature boundary, not by quality tier or time phase.

- Each feature is one complete deliverable. Build it end-to-end in one session.
- Never plan like "Phase 1: basic layout, Phase 2: add logic, Phase 3: polish". That is wasted overhead.
- If a feature is genuinely too large for one session, split into independent sub-features that each ship complete.
- Always update contracts alongside code — they ship together.

## Document precedence

When multiple repository docs apply, use this order:

1. `spec/PROJECT_CONSTITUTION.md`
2. contracts and schemas
3. `spec/ENGINEERING_RULES.md`
4. `spec/UX_RULES.md`
5. `spec/DESIGN_RULES.md`
6. `Docs/04_runtime_experience/OFFISIM_RUNTIME_EXPERIENCE_GDD.md`

The GDD is a presentation-system source of truth.
It does not override constitution-level rules or machine-readable contracts.


Additional runtime-experience implementation companions live in:

- `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
- `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`
