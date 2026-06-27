# Versioned Prompt Enhance profile contract

Checked at: 2026-06-26 NZST
Status: accepted (PR-06)
Scope: a versioned, context-aware Prompt Enhance platform with an isolated Pi
enhance path. Does **not** change the work runtime, Missions, the Loop compiler,
or any persistence — Enhance only rewrites text the user is about to use.

## Decision

Prompt Enhance is a single platform with named, versioned profiles
(`office_instruction`, `collaboration_message`, `loop_design`). Each surface calls
Enhance with its profile; the enhanced text is validated against protected spans
before it is returned; and the enhance call runs on an isolated Pi path with no
tools and no persistence.

## Context

Three surfaces want "make my prompt better": Office instructions, Connect
messages, and Loop design prompts. Each wants different framing — an Office work
instruction, a casual collaboration message, and a structured loop specification
read very differently. Without a contract this becomes three ad-hoc rewriters with
drifting behavior. The design pins three things:

- **Versioned profiles.** A profile (`office_instruction@1`,
  `collaboration_message@1`, `loop_design@1`) names the framing and carries a
  version string, so a profile's behavior can evolve without silently changing
  what every caller gets. Callers select a profile; they do not hand-write
  enhance system prompts. (See `apps/desktop/renderer/src/assistant/enhance`.)
- **Protected-span validation.** Enhance may rephrase prose but must not corrupt
  load-bearing spans the user embedded — e.g. a `/loop` reference chip, an
  `@mention`, or other protected tokens. The enhance result is validated so
  protected spans survive verbatim; if they would be altered, the result is
  rejected rather than silently mangled. This is what lets Enhance preserve a Loop
  chip (PR-10) and a Connect mention.
- **Isolated, no-persistence Pi path.** Enhance is a one-shot text transform, not
  work. It runs on an isolated Pi enhance path with no tools, no project bind, and
  no persistence — it must not write threads, runs, or any product state, and must
  not masquerade as a work runtime (the same boundary as the Connect collaboration
  runtime).

## Consequences

- One Enhance platform serves all three surfaces with consistent, versioned
  behavior instead of three drifting rewriters.
- Protected spans (Loop chips, mentions) round-trip through Enhance intact, which
  is a hard prerequisite for the Office Loop send path.
- Enhance has no side effects: no tools, no persistence — it cannot become a back
  door runtime, and adding a new profile is additive.
- Adding a surface = registering a profile, not building a new rewriter.
