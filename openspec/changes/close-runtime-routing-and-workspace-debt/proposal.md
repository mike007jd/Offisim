## Why

Three independent simplify-pass agents converged on the same four production-risk
debts after R3 release verification: (1) two parallel keyword regexes
(`local-tool-routing.ts` and `evidenceToolsForTask`) silently drift apart and
the routing one false-positives on natural prose ("file a bug", "describe the
workspace") locking out external A2A employees from harmless requests;
(2) when routing or `sanitizePlanEmployees` overrides an LLM-chosen employee
the swap is silent — no event, no log, undebuggable in the wild;
(3) the new project workspace file tree streams the entire file across IPC
just to render a 6 KB preview, blowing memory and serialization on large
logs/JSON; (4) `ProjectWorkspaceFiles` keeps 5 tightly-coupled `useState`s and
the parent re-mounts on every project switch via `key=`, blowing away nav
state. None block 1.0 alone but together they leave R3 short of "production
grade" and were carved out of the prior `008b59e4` simplify commit because
they were behavior changes, not pure DRY. We're pre-launch — no
back-compat shims, single complete delivery.

## What Changes

- **Introduce `task-tool-intent` SSOT** at `packages/core/src/agents/task-tool-intent.ts`
  exporting `detectTaskToolIntent(text): { needsRead, needsWrite, needsBash,
  needsVerification, requiresLocalTools }`. The keyword vocabularies (English +
  Chinese) move into one named, exported set per axis. Routing and completion-
  evidence both consume this — one update site for future vocabulary changes.
- **Remove the four-site `requiresLocalOffisimTools(text)` calls** in
  `boss-node.ts`, `manager-node.ts`, `pm-planner/preflight.ts`,
  `employee-direct-setup-node.ts`. Compute intent once at the graph entry and
  stash on `OffisimGraphState.taskToolIntent`. Downstream consumers read the
  field, not a re-grep.
- **Tighten the routing trigger** so it gates on whole-word verb+object pairs
  (e.g. `read X`, `write X`, `run X`) plus the explicit tool-name tokens
  (`read_file`, `write_file`, `bash`, `pwd`, `pnpm`...) and the explicit
  Chinese imperatives — but NOT bare nouns like "file" / "command" / "命令" /
  "文件" alone. False-positive corpus from agent feedback gets fixture coverage.
- **Make assignment rebinds observable.** When `manager-node` filters out
  LLM-chosen assignments because the candidate fails the routing gate, AND
  when `sanitizePlanEmployees` swaps a missing employee for the planner's
  recommended-order fallback (NOT first-iteration), the runtime SHALL emit a
  new `task.assignment.rerouted` event carrying `{ taskRunId, requestedEmployeeId,
  resolvedEmployeeId, reason }`. Activity feed surfaces it; logger records it.
- **Sort fallback by recommended order**, not iteration order. `sanitizePlanEmployees`
  currently picks `validEmployees[0]` which is "first row from `findByCompany`"
  — replace with the planner's `recommendedEmployees` ordering so the same
  task plan reproduces the same fallback regardless of repo iteration order.
- **Add bounded preview IPC**: new Tauri command `project_read_file_preview(path,
  cwd, max_bytes)` that reads at most `max_bytes` from disk (default 8 KB,
  hard cap 64 KB) and returns `{ content, truncated, totalSize }`. Drop the
  full-file `project_read_file` call from `ProjectWorkspaceFiles.openFile`.
- **Collapse `ProjectWorkspaceFiles` selection state** — `selectedFile` /
  `preview` / `previewLoading` always change together, fold into a single
  `selection: { path, status: 'loading' | 'ready' | 'error', preview?, error? } | null`
  reducer. Remove the parent `<ProjectWorkspaceFiles key={...}>` re-mount in
  `ProjectListPanel` so navigation state (currentPath, selection) survives
  refresh-bus re-renders. Project SWITCH (different `projectId`) still resets
  via the prop-driven `useEffect` clearing `currentPath`.
- **Add deterministic harness scenarios** under `packages/core/harness/scenarios/`
  for: (a) routing rejects "describe the workspace" as needing local tools,
  (b) routing accepts "read README.md", (c) `task.assignment.rerouted` event
  fires when manager picks an external A2A for a local-tool task,
  (d) `sanitizePlanEmployees` rebind emits the event with planner-recommended
  fallback ordering. New invariants in `packages/core/src/testing/invariant-assertions.ts`.

## Capabilities

### New Capabilities

- `task-tool-intent`: SSOT detector that maps a free-text task description to
  a structured `TaskToolIntent` consumed by both routing (boss / manager /
  pm-planner / direct-setup) and completion evidence verification. Owns the
  keyword vocabularies, false-positive guards, and the contract that downstream
  consumers MUST read the structured field, not re-derive from text.

### Modified Capabilities

- `interaction-modes`: routing decisions for local-tool work SHALL consume the
  `task-tool-intent` SSOT (not inline regex), AND when a routing gate
  reroutes an LLM-chosen assignment the runtime SHALL emit
  `task.assignment.rerouted` with the requested vs resolved IDs and reason.
- `long-running-runtime`: completion verifier required-evidence list SHALL be
  derived from the same `task-tool-intent` result that drove routing, so
  routing-evidence parity is structural not coincidental.
- `pm-planner-node-boundaries`: `plan-persistence.ts`'s `sanitizePlanEmployees`
  SHALL emit `task.assignment.rerouted` when it swaps a missing employee, AND
  SHALL pick the fallback from planner-recommended order rather than iteration
  order.
- `project-workspace-binding`: file tree preview SHALL use a bounded
  `project_read_file_preview(path, cwd, max_bytes)` IPC instead of
  full-file read; ProjectWorkspaceFiles selection state SHALL be a single
  state machine and SHALL persist nav state across parent re-renders within
  the same `projectId`.

## Impact

- **Code**: `packages/core/src/agents/task-tool-intent.ts` (new), removal of
  `local-tool-routing.ts` regex (replaced), edits to `boss-node.ts`,
  `manager-node.ts`, `pm-planner/preflight.ts`, `pm-planner/plan-persistence.ts`,
  `employee-direct-setup-node.ts`, `employee-completion.ts`,
  `runtime/completion-verifier.ts`, `graph/state.ts` (`taskToolIntent` field),
  `events/event-factories.ts` (new event), `apps/desktop/src-tauri/src/builtin_tools.rs`
  (new command + capability allowlist), `apps/desktop/src-tauri/permissions/fs-shell.toml`,
  `apps/desktop/src-tauri/capabilities/fs-shell.json`, `packages/ui-office/src/lib/project-workspace-files.ts`,
  `packages/ui-office/src/components/project/ProjectWorkspaceFiles.tsx`,
  `packages/ui-office/src/components/project/ProjectListPanel.tsx`.
- **Harness**: 4 new scenarios + 1 new invariant assertion in
  `packages/core/src/testing/invariant-assertions.ts` (`assertEventEmitted`
  for `task.assignment.rerouted`).
- **Events**: new `task.assignment.rerouted` joins the `task.*` prefix; UI
  EventLog filter map gets the new type. Activity feed renderer needs a
  formatter.
- **No back-compat**: pre-launch — old `requiresLocalOffisimTools` export is
  deleted, not aliased; old `project_read_file` keeps full-file semantics for
  agent tool calls, the new preview IPC is purely additive for the file-tree UI.
- **Live verification**: Tauri release build + project picker + click a 10 MB
  file in the file tree (preview shows truncation), trigger a task whose
  description matches old false positives ("describe the workspace") in
  direct chat with an external A2A employee — must NOT fail-fast.
