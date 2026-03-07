# Project Constitution

This repository follows a lightweight, AI-friendly workflow for building a production-grade product from the first real pass.

The goal is not heavy process.
The goal is rapid iteration without losing architectural discipline.

## Non-negotiable principles

1. Build production-grade from the first meaningful implementation.
   Do not intentionally ship throwaway scaffolding with the plan to “redo it later.”
2. AICS is local-first.
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

Use plans when the task is large enough to benefit from them.

For simple tasks:
- keep planning light

For larger tasks:
- make a small milestone plan
- implement one milestone at a time
- validate after each milestone

## Document precedence

When multiple repository docs apply, use this order:

1. `spec/PROJECT_CONSTITUTION.md`
2. contracts and schemas
3. `spec/ENGINEERING_RULES.md`
4. `spec/UX_RULES.md`
5. `spec/DESIGN_RULES.md`
6. `Docs/04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`

The GDD is a presentation-system source of truth.
It does not override constitution-level rules or machine-readable contracts.


Additional runtime-experience implementation companions live in:

- `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
- `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`
