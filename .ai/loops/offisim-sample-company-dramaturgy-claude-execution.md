# Offisim Sample Company + Deterministic Dramaturgy Claude Execution Loop

Checked at: 2026-06-22 10:56 NZST

Source requirement:

- `/Users/haoshengli/Downloads/Offisim_样板公司审计与确定性演绎计划.md`

This is the execution handoff for Claude. Treat the source requirement as product truth, but execute only against the current repository state after re-reading live code.

## Non-Negotiable Execution Rule

Each implementation phase must complete this full gate before the next phase starts:

```text
implement phase
-> run phase-local verification
-> run simplify xhigh on the integrated phase diff
-> apply simplification fixes that preserve behavior
-> run codex:review on the simplified phase diff
-> verify every finding against live code/runtime evidence
-> fix confirmed findings
-> rerun impacted tests/builds
-> commit the phase
-> only then start the next phase
```

Do not skip this gate for "small" changes. Do not defer review fixes to a later phase. Do not treat codex:review output as automatically true: every finding must be confirmed or rejected with concrete code/runtime evidence before moving on.

## Repository Rules To Obey

- Read `AGENTS.md`, `CLAUDE.md`, and the maintained docs before editing.
- Confirm current real-world time before making any "current/latest/supported" technical judgment.
- Offisim remains Pi Agent-only. Do not restore Offisim-owned provider/model catalogs, Claude Code SDK lane, Codex lane, OpenAI Agents lane, legacy Boss/Graph runtime, or runtime provider profiles.
- The desktop product is Tauri-only. Do not add standalone web/browser/launcher product work.
- Renderer ownership stays in `apps/desktop/renderer`.
- Do not put animation instructions into Pi prompt/context.
- Do not let GUI scene logic decide agent execution topology.
- Do not let LLMs generate action timelines.
- Before editing a function/class/method, run GitNexus impact analysis for the symbol and record direct callers, affected processes, and risk. Warn before editing HIGH/CRITICAL risk surfaces.
- Before any commit, run GitNexus `detect_changes()` and confirm the affected scope matches the phase.
- Preserve unrelated dirty-tree changes.

## Authority Boundary

- Local code edits, local tests, local release builds, local commits, and local temporary worktrees are authorized.
- Do not push, open/merge PRs, deploy, mutate production/shared services, delete user data, or force-delete branches without explicit user authorization.
- If a phase reveals a product decision that cannot be safely inferred, choose the least invasive path that preserves current product direction and record the assumption. Stop only if the wrong choice would be destructive or expensive to reverse.
- Keep one coherent commit per completed phase unless a phase must be split for reviewability. Never commit a phase before its simplify/review/fix gate is closed.

## Native Claude Topology

- Use Claude Code's native subagents, agent teams, background sessions, worktree isolation, and agent cleanup controls where available.
- Do not build a custom fleet controller, scheduler, daemon, lifecycle database, or wrapper script to manage Claude agents.
- Use read-only agents aggressively for discovery, contract review, fixture design, and post-diff review.
- Use writable agents only on non-overlapping ownership boundaries. If two tasks would edit the same unstable files, sequence them.
- Freeze shared contracts before broad implementation fan-out.
- Maker and checker must be separate: the writer does not get to be the only reviewer for its own phase.
- Consume every worker result, integrate or reject it, then close/archive the worker and release temporary worktrees through native controls.

## Integration Policy

- Integrate in dependency order: Phase 0 must land before semantic event work; semantic event contracts must land before beat composer and scene movement.
- Each phase's accepted work must be preserved as a commit before the next phase starts.
- After integrating a worker result, rerun the relevant phase gates on the integration head, not only inside the worker context.
- Final verification must run on the actual final revision. If work is later merged to `main`, verify `main` itself before claiming completion.

## Definition Of Done

The whole requirement is done only when:

- template display data and materialized company data share one canonical source of truth;
- all five built-in templates create truthful employees, roles, personas, zones, appearances, capabilities, and home workstations;
- preview zones and materialized zones match;
- Pi persona prompts receive the template expertise/style through the current persona reader shape;
- existing template companies receive a safe home-zone/persona backfill;
- semantic run events can rebuild run tree, employee state, activity timeline, artifacts, approvals, and final status;
- the deterministic beat composer produces identical beats for fixed fixture input;
- prefab affordances and layered character performance work in 2D and 3D from the same semantic truth;
- high-value beats work without per-template coordinate scripts;
- Focus, Office, Cinematic, reduced-motion, replay, and performance constraints are covered;
- release `.app` has been built from the current worktree and verified through real desktop interaction when user-visible desktop behavior changes and at final acceptance.

## Phase Plan

### Phase 0 - Template Truth Repair

Scope:

- Merge renderer/core template definitions into one canonical template definition exported by core and consumed by renderer plus `CompanyTemplateService`.
- Remove duplicated renderer roster sources, handwritten preview zone sources, and separate employee bio sources.
- Upgrade template personas to v2 profile shape consumed by the current Pi persona reader.
- Remove legacy template runtime config fields such as `modelPreference`, `temperature`, and `maxTokens`.
- Create and persist home-zone workstations during materialization.
- Assign every template employee to a real workstation/zone.
- Correct the five sample-company rosters and role semantics from the source requirement.
- Add a safe migration/backfill for existing template companies with missing persona/home workstation data.
- Add a template contract harness.

Acceptance:

- Each built-in template preview shows the same zone labels as materialization.
- Created employee count, display title, role slug, capabilities, persona, appearance, and home zone match the canonical definition.
- Every template employee resolves to one valid workspace.
- Pi system prompt includes the template employee's expertise/style through the current persona path.
- No built-in template writes legacy runtime config.
- All five templates can be created and opened in the office scene.

Required gates before Phase 1:

- phase-local template harness passes;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 0.

### Phase 1 - Semantic Event Contract

Scope:

- Define neutral semantic agent run events from real Harness/Pi facts only.
- Include parent/child run, employee, relation, workKind, activityKind, artifacts, approvals, status, timestamps.
- Keep animation names, coordinates, room names, and prefab-specific concepts out of this contract.
- Ensure tool facts determine activityKind; renderer must not parse raw shell content for choreography.

Acceptance:

- A real or fixture event stream can reconstruct run tree, current employee states, activity timeline, artifacts, approvals, and terminal status.
- Team conversation root sessions remain invisible director/control processes; do not create a fake universal actor.

Required gates before Phase 2:

- semantic event fixture/harness passes;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 1.

### Phase 2 - Dramaturgy Store And Beat Composer

Scope:

- Normalize semantic events into work signals.
- Coalesce noisy events.
- Track per-run semantic state.
- Apply priority, cooldown, sustained-activity rules, anchor reservation, and deterministic seeded variant selection.
- Output a debug beat timeline first; do not jump straight to complex movement.

Acceptance:

- Fixed fixture events produce byte-for-byte identical beat output across repeated runs.
- Approval/failure can interrupt lower-priority beats.
- Read/search/tool chatter collapses into stable activity instead of movement spam.

Required gates before Phase 3:

- dramaturgy fixture harness passes twice;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 2.

### Phase 3 - Prefab Affordances And Character Layers

Scope:

- Add interaction anchors to prefabs.
- Replace the single coarse character action state with layered performance state.
- Share actor position/performance truth between 2D and 3D.
- Support V1 movement and action fragments: idle, walk, sit, stand, turn, type, read, note, inspect terminal, write board, present, annotate review, handoff, listen, nod, discuss, wait/approval, blocked, celebrate.
- Add deterministic navigation and anchor reservation.

Acceptance:

- The same beat produces the same actor/zone choice in 2D and 3D.
- Two actors do not occupy the same reserved seat/anchor.
- Custom offices can perform through prefab affordances without template-ID coordinate branches.

Required gates before Phase 4:

- scene/affordance harness passes;
- renderer typecheck/build;
- release `.app` build and desktop smoke if visible behavior changed;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 3.

### Phase 4 - High-Value Beats

Implement in this value order:

1. working micro-actions;
2. plan meeting;
3. delegation fan-out;
4. research/library;
5. review/shared-screen;
6. approval/blocked;
7. artifact/join/complete;
8. failure/recovery;
9. sustained compute/server.

Acceptance:

- Office mode moves only for high-value beats.
- Tool activity changes local performance state, not full-room movement.
- Compute beats move to Server/GPU only after sustained activity.
- Failure/recovery, approval, and join states are visually distinct and driven by semantic events.

Required gates before Phase 5:

- beat fixture matrix passes;
- renderer typecheck/build;
- release `.app` build and desktop smoke;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 4.

### Phase 5 - Template And Employee Personality

Scope:

- Add `CompanyPerformanceProfile`.
- Add `EmployeePerformanceProfile`.
- Add deterministic variant weighting and anti-repeat.
- Implement Focus, Office, Cinematic, and reduced-motion modes.
- Keep performance profiles out of Pi prompt and Harness execution logic.

Acceptance:

- Template family/pace/collaboration bias changes presentation weighting only.
- Employee archetype/tempo/expressiveness/social style changes performance flavor only.
- Focus, Office, Cinematic, and reduced-motion share the same semantic truth.
- No mode can invent facts, actors, success/failure, or parent/child relations.

Required gates before Phase 6:

- personality/mode fixture harness passes;
- renderer typecheck/build;
- release `.app` build and desktop smoke;
- `pnpm validate`;
- `simplify xhigh`;
- `codex:review`;
- confirmed findings fixed and revalidated;
- `detect_changes()`;
- commit Phase 5.

### Phase 6 - Replay And Performance

Scope:

- Persist source semantic events.
- Store `dramaturgyVersion` and deterministic seed inputs.
- Implement deterministic replay.
- Run 20-30 employee performance scenario.
- Measure scene frame budget.
- Add child-run stress scenario.

Acceptance:

- Replay uses stored semantic source events, version, and seed inputs, not generated scripts.
- Replayed output is deterministic for the same source data and dramaturgy version.
- 20-30 employee scenario stays within agreed scene performance budget.
- Child-run stress does not produce actor collisions, movement spam, or invalid run hierarchy.

Required final gates:

- full fixture matrix passes;
- `pnpm lint`;
- `git diff --check`;
- `pnpm validate`;
- `cargo check` in `apps/desktop/src-tauri`;
- `pnpm build`;
- release `.app` build from exact current worktree path;
- Computer Use desktop interaction against `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`;
- `simplify xhigh`;
- final `codex:review`;
- confirmed findings fixed and all impacted gates rerun;
- `detect_changes()`;
- final commit.

## Simplify Gate Contract

`simplify xhigh` is not optional cleanup. Use it to remove duplicated logic, stale compatibility paths, accidental overengineering, and unnecessary abstractions introduced in the phase. It must not:

- weaken acceptance criteria;
- remove required test coverage/harness evidence;
- collapse Pi-owned runtime responsibilities back into Offisim;
- replace deterministic event/beat logic with prompt instructions;
- introduce template-specific coordinate scripts;
- hide unresolved review findings as "known limitations."

After applying simplifications, rerun the smallest impacted gate first, then the phase gate.

## Codex Review Gate Contract

Run `codex:review` after simplification, on the actual current phase diff. For each finding:

- mark `confirmed`, `false positive`, or `needs product decision`;
- cite the exact file/line or runtime evidence used to decide;
- fix confirmed findings before next phase;
- rerun targeted gates after each fix batch;
- run phase-level gates again after the final fix;
- do not proceed while any confirmed blocker/high/moderate issue remains.

If a finding is false positive, record why in the phase notes and keep moving.

## Verification Notes

- Use `pnpm validate` as the main repository gate.
- Use `pnpm lint` when checking whole-tree hygiene because untracked temporary files can break Biome while `pnpm validate` stays green.
- For release-grade desktop acceptance, dev webview, localhost browser, and bundle-id launch are not enough.
- Launch the exact release `.app` path from the current worktree.
- Use Computer Use for final desktop interaction and screenshot evidence.
- If Computer Use cannot attach to release `.app`, treat desktop verification as blocked, not passed.

## Completion Report Required From Claude

At the end of every phase, report only:

- phase commit;
- concrete acceptance evidence;
- `simplify xhigh` result;
- `codex:review` result and how findings were resolved;
- gates run;
- remaining blockers, if any.

At final completion, report:

- final revision;
- acceptance evidence across all phases;
- release `.app` verification evidence;
- GitNexus `detect_changes()` scope confirmation;
- cleanup confirmation for temporary files, agents, worktrees, branches, and runtime resources.
