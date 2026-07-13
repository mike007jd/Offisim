---
name: fleet-development-loop
description: >-
  Compile a rough natural-language software-development request into a
  repository-specific, evidence-gated, budget-aware parallel development loop,
  then run it on the current harness's native subagents, agent teams, worktrees,
  task controls, and Git. Use for features, products, migrations, refactors, and
  bug campaigns. From a rough requirement it infers scope and acceptance, proposes
  a consumption tier (light / standard / aggressive) with a rough cost envelope,
  and asks only the few questions it cannot safely infer. This is an instruction-only
  skill: it defines method and delegates all runtime to the harness; never build a
  separate fleet controller or scheduler.
---

# Fleet Development Loop

A **loop compiler** for software development. The user supplies a rough requirement; this skill inspects the real repository, infers scope and acceptance, proposes a consumption tier and budget, asks only the few questions it cannot safely infer, compiles a repository-specific loop, and either presents it (Design) or executes it (Execute) through the current harness's native capabilities.

It compiles a *custom* loop against your actual repository and chosen budget — complementary to static, copy-paste loop libraries, not a generic one-size prompt.

## Architectural boundary

This skill defines **method**, not runtime infrastructure.

The current harness owns:

- spawning, supervising, resuming, stopping, closing, or archiving agents and sessions;
- creating, handing off, retaining, restoring, and removing managed worktrees;
- task lists, agent communication, permissions, approvals, and session state;
- native Git and pull-request workflows exposed by the harness.

Never create or require an external fleet controller, scheduler, worker daemon, lifecycle database, lease/heartbeat system, or orchestration script. In particular, do not create `fleetctl.py`, a custom agent manager, or a self-test program for the fleet mechanism. Use the harness's native primitives directly.

Normal repository commands, tests, builds, and Git operations are allowed when they are part of developing or verifying the product. They must not be used to reimplement the harness.

## Core loop

Outer pass (runs once, end to end):

`request → inspect → infer & propose (scope, acceptance, consumption tier, budget) → clarify only what can't be inferred → compile → discover in parallel → freeze contracts → implement in waves → verify independently → integrate → verify target revision → clean native resources → report`

Inner loop (bounded): every gate runs `implement → verify → repair` until it passes or reaches its **fix-wave budget** (default 3 repair waves per gate), at which point it escalates instead of recursing forever.

A run reaches exactly one of three **exit states**:

- **success** — every acceptance criterion passes on the actual integrated revision, and cleanup is done;
- **budget-exhausted** — a declared budget cap (fix-waves per gate, total agents, concurrent agents, recursion depth, wall-clock, or tokens) is reached first; stop and hand back partial results plus a precise "what remains" list;
- **blocked-handoff** — a human-owned or out-of-authority decision is required; stop and escalate with the specific question.

`success` is reached only when:

1. the requested outcome satisfies its acceptance criteria;
2. accepted work is integrated into the intended target branch or PR path;
3. verification passes on the actual integrated revision;
4. temporary agents, sessions, worktrees, branches, and runtime resources are closed, removed, archived, or intentionally retained;
5. the repository is left in a clean, understandable state.

## Relationship to self-scheduling loops

This skill compiles and runs **one** development pass end to end: a human supplies the requirement, the loop fans out, verifies, integrates, and reports. It is the high-parallelism *body of one turn* — not a self-scheduling, self-discovering loop that runs unattended round after round.

To make the work **recurring** (nightly bug campaigns, CI triage, dependency sweeps, PR babysitting), do not add a scheduler here. Compose with the harness's own primitives:

- **scheduling** — the harness's native recurring trigger (an interval, a cron routine, or a cloud schedule) starts each round; this is what turns one pass into a loop.
- **discovery** — a small separate skill decides *what the work is this round* (failing CI, newly opened issues, stale dependencies), instead of a human handing over the requirement.
- **this skill** — runs as the per-round engine on each discovered item: contract freeze, parallel writers, independent verification, wave integration, cleanup.
- **persistence** — the harness's native memory/state or a sibling tracker skill records what was handled so the next round skips it instead of re-processing; never a bespoke lifecycle store built in this skill. (Distinct from Resume mode, which only continues an interrupted single pass.)

The composition stays inside the architectural boundary — scheduling, discovery, and persistence are native harness or sibling-skill capabilities, not a controller built here.

## Operating modes

Infer the mode from the request:

- **Design**: inspect, clarify, and generate a portable loop document; do not implement.
- **Execute**: compile the loop and run it with native harness capabilities.
- **Resume**: read the existing loop document plus current repository/session state, reconcile reality, and continue from the first unmet gate.
- **Audit**: inspect an existing or completed loop, identify weak decomposition, missing gates, integration risk, or cleanup debt.

If the user asks to “implement,” “build,” “fix,” “migrate,” or “develop,” default to Execute. If they ask to “design a loop,” default to Design.

## Non-negotiable principles

1. **Repository reality first.** Inspect actual code, instructions, Git state, tests, CI, build commands, architecture, and relevant runtime behavior before designing the loop.
2. **Ask only consequential questions.** Do not ask for information that can be discovered or safely inferred.
3. **Use native orchestration.** Explicitly use the current harness's subagents, teams, background sessions, worktrees, task list, and lifecycle controls. Do not simulate them with scripts.
4. **Concurrency is a declared budget, not a default.** Pick a consumption tier (light / standard / aggressive) and fan out only within its caps. Spend more concurrency where tasks are independent, competing hypotheses are useful, or fresh verification raises confidence — but the aggressive bias (token cost secondary) is unlocked only when the requirement's stakes justify it or the user opts in, never silently.
5. **Do not maximize headcount for its own sake.** Every agent needs a distinct question, ownership boundary, implementation shard, variant, or review gate.
6. **One concurrent writer per ownership boundary.** Parallel writers must not intentionally edit the same files or unstable interface in the same wave.
7. **Freeze shared contracts before broad write fan-out.** Stabilize interfaces, data shapes, behavior, and verification oracles first.
8. **Maker and checker are separate.** A fresh agent or deterministic oracle must verify meaningful changes.
9. **Evidence outranks self-report.** Tests, builds, traces, screenshots, reproducible demos, and explicit rubric checks determine success.
10. **Integrate by dependency wave.** Do not wait until every branch is finished before discovering conflicts.
11. **Default branch is the final local destination when authorized.** Respect repository policy and branch protection. Pushing, remotely merging, deploying, or mutating production requires explicit authority.
12. **Lifecycle cleanup is part of done.** Consume each agent's result, then close or archive that agent promptly. Remove or release its worktree when recoverability is secured.
13. **The loop document is declarative.** It records intent, topology, gates, and policy—not live scheduler state. Live state belongs to the harness.
14. **Keep the engineer in control of irreversible decisions.** Escalate ambiguous product choices, destructive migrations, production effects, and architecture decisions that exceed agreed authority.

## Phase 1 — Inspect before questioning

Inspect the repository and available harness capabilities.

Determine:

- repository root, current and default branches, dirty state, relevant recent changes;
- project instructions such as `AGENTS.md`, `CLAUDE.md`, local skills, contribution rules, and CI policy;
- package manager, build/test/lint/typecheck commands, launch path, and authoritative environment;
- relevant modules, data flow, interfaces, tests, shared-file hotspots, and likely integration boundaries;
- available native parallel mechanisms: subagents, agent teams, background agents, worktree isolation, task coordination, thread controls, and handoff;
- runtime resources that can collide across worktrees: ports, databases, queues, containers, caches, test accounts, environment files, or generated artifacts.

Do not change code during this phase unless the user explicitly requested immediate execution and the first change is already justified by repository evidence.

## Phase 2 — Infer, propose, then ask only what you must

The user gives a rough requirement; you do the thinking. After inspection, first **infer and propose** — as recommendations the user can accept or correct, not as an interview:

- the observable definition of "done" (acceptance demo);
- scope, non-goals, and protected behavior;
- the acceptance oracle for each criterion;
- a **recommended consumption tier** (light / standard / aggressive) with one line of reasoning and a rough cost envelope (expected agent count, waves, relative spend).

Then ask only the questions you genuinely cannot infer or safely default — normally **at most three**, never more than five. Every question carries a recommended default so the user can answer "use the defaults."

Only ask about things that materially affect:

- the observable definition of success;
- scope or protected behavior;
- product or architecture choices that cannot be inferred;
- the authoritative verification environment;
- permission to merge locally to the default branch, push, open/merge a PR, deploy, or alter external systems;
- the consumption tier — only if the user may want to override the one you recommended;
- whether expensive competing variants are desired for uncertain areas.

Do not repeat anything already answered in the conversation or repository, and do not ask for anything you just inferred and proposed unless the choice is consequential and ambiguous.

## Phase 3 — Compile the loop

Synthesize the requirement, answers, and repository evidence into a concrete loop. Do not merely concatenate agent findings.

The compiled loop must define:

- outcome and user-visible success demo;
- scope, non-goals, and protected behavior;
- repository facts and assumptions;
- human-owned decisions and authority boundary;
- **consumption tier and budget**: chosen tier, max concurrent agents, max total agents, max recursion depth, max fix-waves per gate (default 3), and any wall-clock or token ceiling;
- **the three exit states** (success / budget-exhausted / blocked-handoff) and what each returns to the user;
- acceptance criteria and verification oracle for each criterion;
- task dependency graph and integration waves;
- native agent topology and worktree policy;
- ownership boundaries and shared contracts;
- review lanes and adjudication rules;
- merge path and post-merge verification;
- stop, retry, escalation, budget-exhaustion, and cleanup conditions.

For Design mode, save the generated document only when useful or requested, preferably as `.ai/loops/<descriptive-slug>.md` unless the repository already has a convention. The user never fills this document manually; the skill generates it.

For Execute mode, present a compact summary of the compiled loop, then begin using native harness orchestration. A persistent loop document is recommended for long, resumable, or cross-harness work, but it is not a custom scheduler and must not mirror every live agent event.

Read [LOOP_COMPILATION.md](LOOP_COMPILATION.md) for required content and loop shapes.

## Phase 4 — Parallel discovery and plan selection

Use multiple read-only agents freely (within the tier's concurrency cap) when uncertainty is meaningful — read-only discovery is the one place collision cost is negligible. Assign distinct lenses, for example:

- current code and behavior flow;
- product/user experience and edge states;
- architecture and interface boundaries;
- verification strategy and missing oracles;
- regression and operational risk;
- official dependency or API documentation;
- competing implementation approaches.

For important ambiguous decisions, commission at least two independent proposals and a fresh evaluator. The lead agent selects or synthesizes a plan against explicit criteria.

Discovery agents return concise findings with file paths, evidence, unresolved questions, and recommended next steps. Consume the findings, update the compiled loop, and close those agents unless follow-up is genuinely needed.

## Phase 5 — Freeze contracts and verification

Before broad parallel implementation:

1. define shared interfaces and data shapes;
2. define ownership boundaries;
3. identify or create the strongest available acceptance oracles;
4. record expected behavior for success, error, loading, empty, cancellation, retry, and compatibility states when relevant;
5. define the command or observable evidence that closes every gate.

Prefer tests or executable checks written independently from the implementation. When deterministic testing is impossible, use structured fresh-context review and a reproducible manual demonstration.

Read [VERIFICATION.md](VERIFICATION.md).

## Phase 6 — Build the task graph and active frontier

Decompose by dependency and edit ownership, not by generic job titles.

Useful units include:

- independent vertical slices;
- packages, endpoints, components, migrations, tests, or defects with distinct file ownership;
- competing implementation or debugging hypotheses;
- test-generation, performance, UX, regression, and documentation-verification lanes;
- repeated transformations over independent shards.

The active fleet is the current parallel frontier:

`ready independent tasks + justified variants + independent reviewers`

When the implementation frontier narrows, use spare agents for adversarial review, edge-case discovery, additional tests, reproducibility, performance measurement, documentation validation, or investigation of future waves. Do not create duplicate writers merely to keep every slot occupied.

Read [PARALLELISM.md](PARALLELISM.md).

## Phase 7 — Fan out through native harness primitives

Use the strongest suitable native mechanism currently available:

- bounded subagents for focused research, implementation, tests, and review;
- agent teams when peers need a shared task list or direct coordination and the feature is available;
- background sessions for long independent streams;
- native worktree isolation for concurrent writers or competing variants;
- the harness's task list, agent view, thread controls, handoff, and archive/close functions for lifecycle management.

Each delegated task must include:

- a single clear outcome;
- relevant context and frozen contracts;
- owned files or interface boundary;
- dependencies and prohibited overlap;
- required tests/evidence;
- return format: summary, changed files/commit or diff reference, verification results, risks, and integration notes;
- completion behavior: return the result and stop; do not remain idle.

Review-only agents usually inspect immutable diffs/commits and do not need a writable worktree.

Never tell agents to create another custom controller. Nested delegation is allowed only when the harness supports it and the parent remains accountable for a bounded result.

## Phase 8 — Execute and integrate in waves

For each ready dependency wave:

1. spawn native workers on independent ownership boundaries or variants;
2. let each writer inspect its exact scope before editing;
3. require small, coherent commits or equivalent handoff units;
4. run task-local verification;
5. send the resulting diff/commit to fresh independent reviewers;
6. accept, repair, reject, supersede, or split the task based on evidence;
7. integrate accepted work through the harness's native Git/worktree/handoff flow;
8. run integration-level checks at the integrated revision;
9. update downstream agents when contracts or integration head changed;
10. close completed/rejected agents and release their native worktrees once their result is safely integrated, archived, or discarded.

The lead/orchestrator coordinates, decides, and synthesizes. It may make small integration edits, but those edits also require fresh verification.

## Phase 9 — System verification and adversarial review

After all planned implementation waves are integrated:

- run the full relevant test, lint, type, build, integration, end-to-end, launch, and product-demo matrix;
- use fresh agents to review business correctness, regressions, architecture consistency, UX, maintainability, and scope discipline as applicable;
- adjudicate reviewer disagreements with deterministic evidence where possible;
- run bounded fix waves for blockers — by default at most **3 repair waves per gate**; if a gate still fails after its fix-wave budget, exit that gate to **blocked-handoff** instead of repairing indefinitely;
- block only on a stated severity floor (open critical/major findings); log lower-severity findings as accepted follow-ups so the review/fix sub-loop has a falsifiable exit;
- stop and ask the user only when the remaining decision is genuinely human-owned, outside the granted authority, or the loop's budget is exhausted.

Do not equate “all agents completed” with “the feature is complete.”

## Phase 10 — Merge and verify the real target revision

Before merging:

- all required gates pass on one known integration revision;
- the target branch state is understood;
- no unresolved blocking review remains;
- merge/PR authority is confirmed.

Use the repository's normal merge policy. If authorized to merge locally, integrate into the detected default branch. If policy requires a pull request, prepare or use that path instead.

After integration into the target, verify the actual resulting target revision—not merely the source worktree. If verification fails, repair or revert according to repository policy before claiming completion.

Never push, remotely merge, deploy, or perform destructive external actions without explicit authority or a clearly established trusted policy.

## Phase 11 — Native lifecycle cleanup

Cleanup is a required final phase, but the harness performs it through its own controls.

### Agent/session cleanup

- consume every completed result;
- stop duplicated, stale, blocked, or superseded workers;
- close or archive completed subagents, teammates, and background sessions through native lifecycle controls;
- ensure no completed worker remains active merely because it was once spawned.

### Worktree/branch cleanup

- use the harness's native managed-worktree cleanup or archive behavior first;
- preserve accepted work before removal through integration, commit, handoff, or the harness's snapshot mechanism;
- retain rejected experiments only when they have explicit future value; otherwise archive a concise finding and release them;
- remove temporary branches after accepted work is safely present on the target and post-merge verification passes;
- inspect final Git/worktree state and resolve leftovers attributable to the run;
- never force-delete unknown user work.

### Runtime cleanup

Stop temporary servers, containers, databases, queues, port allocations, test accounts, locks, and generated artifacts created by the run.

### Codebase gardening

Remove only debris introduced by the work: debug logging, temporary flags, obsolete scaffolding, duplicate helpers, stale comments, unused dependencies, and accidental generated files. Do not turn cleanup into an unrelated refactor.

Read [INTEGRATION_CLEANUP.md](INTEGRATION_CLEANUP.md).

## Phase 12 — Final report

Return a concise engineering report containing:

- outcome and target revision/PR;
- major changes and architecture decisions;
- agents/lanes used at a high level, not a transcript dump;
- verification evidence;
- rejected variants or important failed hypotheses;
- remaining risks or manual checks;
- for large runs, a **reviewable sample** of representative changes — a handful of concrete locations the engineer should read and be able to explain back in their own words; an inability to explain a sampled change precisely is the signal that understanding has fallen behind the code;
- cleanup confirmation: agents closed, worktrees handled, temporary branches/resources handled, repository status understood.

For long-running work, preserve only durable knowledge that benefits future development. Do not commit ephemeral fleet bookkeeping solely to prove that many agents ran.

## Failure and escalation rules

Pause or ask for a human decision when:

- acceptance criteria conflict;
- the request requires a material product decision not inferable from context;
- destructive data migration or production impact exceeds authority;
- branch protection or remote policy blocks the agreed merge path;
- repeated evidence shows the selected architecture is invalid;
- available harness capabilities cannot safely isolate concurrent writers;
- the same gate fails its fix-wave budget (default 3 consecutive repair waves) — exit to **blocked-handoff**;
- a declared budget cap (fix-waves per gate, total agents, concurrent agents, recursion depth, wall-clock, or tokens) is reached — exit to **budget-exhausted** with partial results and a precise "what remains" list.

Otherwise, reduce scope, repartition the graph, spawn a fresh hypothesis/reviewer agent, or continue with the strongest safe native mechanism within budget.
