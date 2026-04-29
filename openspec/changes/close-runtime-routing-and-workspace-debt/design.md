## Context

After R3 release verification (commits `0c779084` + `3c9ad841`) closed the
critical gateway-lane / SDK-lane / project-workspace-files gaps, a
parallel three-agent simplify pass (recorded in `008b59e4`) flagged four
production-grade debts that were intentionally deferred because they were
behavior changes rather than pure DRY:

1. `packages/core/src/agents/local-tool-routing.ts` exports a single mega
   regex used in 4 graph nodes (boss / manager / pm-planner preflight /
   employee direct setup). The regex includes bare nouns (`file`, `command`,
   `命令`, `文件`) so natural-prose chat ("describe the workspace", "file
   a bug", "请发个文件") matches and silently locks routing to internal
   employees, hiding all external A2A employees from those chats.

2. `packages/core/src/agents/employee-completion.ts::evidenceToolsForTask`
   re-derives the same intent from the same task text with a parallel
   keyword vocabulary. The two vocabularies overlap but are not identical
   and have no shared SSOT, so updating one without the other silently
   breaks routing/evidence parity (an internal employee gets routed because
   the routing regex fires, then completion verification doesn't require
   the matching evidence because the completion regex didn't fire).

3. `packages/core/src/agents/manager-node.ts` filters
   `decision.assignments` against `validEmployeeIds` and silently drops
   rejected assignments. `pm-planner/plan-persistence.ts::sanitizePlanEmployees`
   silently swaps a missing employee for `validEmployees[0]` (iteration
   order from `findByCompany`). Neither emits an event or log — debugging
   "why did Maya pick up Alex's task" requires reading the source.

4. `ProjectWorkspaceFiles.tsx::openFile` calls `project_read_file` which
   reads the entire file into Rust memory, serializes to JSON, ships
   through IPC, then JS slices to 6 KB for preview. A 50 MB log preview
   pays 50 MB of IPC + JSON serialization cost. Plus 5 tightly-coupled
   `useState`s and a `<ProjectWorkspaceFiles key={...}>` wrapper in
   `ProjectListPanel` that blows away nav state every time the parent
   re-renders (refresh-bus event, project list refetch, etc.).

The user's directive: pre-launch, no back-compat, single complete delivery
covering all four. This change folds them into one production-grade pass.

## Goals / Non-Goals

**Goals:**
- One SSOT (`task-tool-intent.ts`) consumed by routing AND completion-evidence
  so future vocabulary edits hit one site and routing/evidence parity is
  structural.
- Eliminate free-text false positives (verb-less nouns, narrative prose) by
  requiring whole-word verb+object pairs OR explicit tool-name tokens OR
  explicit Chinese imperatives.
- Make every assignment rebind observable: structured event + activity-log
  entry + logger record. Operator can answer "why did Maya pick this up"
  from the activity feed.
- Bounded preview IPC: file-tree preview never reads more than `max_bytes`
  from disk regardless of file size.
- Single state machine for `ProjectWorkspaceFiles` selection, nav state
  survives parent re-renders within the same project.
- Deterministic harness coverage so future changes can't silently regress
  the false-positive corpus.

**Non-Goals:**
- Replacing keyword-based intent detection with an LLM classifier — that
  would change the determinism contract used by harness scenarios. Stay
  with explicit token sets.
- Backporting `requiresLocalOffisimTools` as an alias. Pre-launch means
  the old export is deleted, period.
- Adding event filters for the new `task.assignment.rerouted` event to
  the EventLog UI before the runtime emits it (chicken-and-egg). The
  filter map is updated in the same change.
- Rewriting `ProjectListPanel` summary architecture. Only the
  `<ProjectWorkspaceFiles key=>` wrapper changes — the surrounding
  layout stays.

## Decisions

### Decision 1: SSOT lives in `agents/task-tool-intent.ts`, not in `shared-types`

**Rationale**: The intent detector is a runtime concern (consumed by the
LangGraph nodes during graph execution) — it has no client surface and
no platform/desktop split. Putting it in `agents/` keeps the import
graph clean (`agents/*.ts → task-tool-intent.ts → no further deps`).
`shared-types` would force the keyword sets into the public schema with
no consumer outside the runtime.

**Alternative considered**: a new package `@offisim/intent`. Rejected —
single-file SSOT does not justify package overhead, and core import
graph already correctly walls off browser-incompatible deps via
`browser.ts` re-exports.

### Decision 2: Intent is precomputed once at graph entry, stored on `OffisimGraphState`

`OffisimGraphState.taskToolIntent: TaskToolIntent | null` is populated by
boss-node / pm-planner preflight when they first see the user message.
Downstream consumers (manager-node, employee-direct-setup, completion
verifier) read the field. The original 4 callers of
`requiresLocalOffisimTools(text)` go away.

**Rationale**: re-grepping the same text 4 times per turn is ~µs each
but conceptually wrong — if the keyword vocab changes mid-turn (e.g.
hot-reload of the SSOT during dev), four callers can disagree. State
field guarantees one decision per turn.

**Alternative**: a memoized `WeakMap<string, TaskToolIntent>` in the
SSOT module. Rejected — graph state is the canonical place for
per-turn derived facts; memoization creates a hidden global with
unclear lifetime.

### Decision 3: Routing trigger requires verb+object OR explicit tool-name OR Chinese imperative

The new regex (or, more accurately, the new structured detector) accepts:
- Whole-word tool tokens: `read_file`, `write_file`, `bash`, `pwd`, `ls`,
  `cat`, `pnpm`, `npm`, `cargo`, `timeout`
- Verb+object English: `read file/path/workspace/content`, `write
  file/path/workspace/content`, `create file`, `quote bytes/content/file`,
  `run pwd/ls/cat/pnpm/npm/cargo/sleep`, `execute command/bash/shell`
- Chinese imperatives: `读取`, `读回`, `写入`, `写回`, `创建.{0,8}文件`,
  `保存.{0,8}文件`, `运行.{0,8}(命令|脚本)`, `执行.{0,8}(命令|脚本)`,
  `查看.{0,40}(文件|工作区|readme)`, `引用.{0,40}(文件|内容)`
- Workspace-specific Chinese: `工作区(里|内|的|路径)`, `项目(目录|工作区)`

It does NOT accept:
- Bare nouns: `file`, `command`, `path`, `terminal`, `命令`, `文件`,
  `目录`, `终端`
- Phrases: `file a bug`, `command line interface`, `keep the path
  forward`, `describe the workspace`

**Rationale**: bare-noun matches caused the documented false positives.
Verb+object encodes intent (the user wants to *do* something to a
file, not just mention one).

**Alternative**: ML/embedding classification. Rejected for determinism
+ cost reasons (per non-goal).

### Decision 4: Rerouted assignments emit `task.assignment.rerouted`

New event factory in `events/event-factories.ts`:
```
taskAssignmentRerouted(companyId, taskRunId, requestedEmployeeId,
  resolvedEmployeeId, reason, threadId, source: 'manager' | 'pm-planner')
```

`reason` is a string union: `'requires-local-tools'` (manager rerouted
because the LLM picked an external A2A employee for a local-tool task),
`'employee-not-found'` (sanitize swapped a missing employee),
`'employee-disabled'` (sanitize swapped a disabled employee).

UI filter map (`ui-office/src/lib/event-log-store.ts`) gets the new
type added to `TYPE_PREFIX_MAP['task.assignment']`. Activity feed
renderer (`ui-office/src/components/activity-log/`) gets a formatter
that prints "Manager rerouted task X from <requestedName> to
<resolvedName>: <reason>".

### Decision 5: Sanitize fallback uses planner-recommended order

The planner already returns its preferred ordering in `recommendedEmployees`
(or equivalent — TBD when we read `plan-persistence.ts`). When sanitize
needs a fallback, it picks the first valid employee from that order
rather than `validEmployees[0]` (iteration order). If no recommendation
exists, fall back to `validEmployees[0]` AND emit the rerouted event
with reason `'no-recommendation-fallback'`.

### Decision 6: New Tauri command `project_read_file_preview`

Signature:
```rust
project_read_file_preview(
    path: String,
    cwd: Option<String>,
    max_bytes: u32,  // hard-capped to 64 KB
) -> Result<ProjectFilePreview, String>

struct ProjectFilePreview {
    content: String,        // valid UTF-8, possibly truncated mid-byte-safe
    truncated: bool,
    total_size: u64,        // file size on disk
}
```

Implementation reads at most `max_bytes` (capped to `MAX_PREVIEW_BYTES =
65536`), then validates UTF-8 boundary — if the truncated byte slice ends
mid-codepoint, walks back to the last valid UTF-8 boundary so the JS
side gets a clean string. Falls back to lossy conversion only if the
backwards walk fails (binary file).

The existing `project_read_file` keeps full-file semantics — it's used by
agent tool calls (`read_file` builtin tool), where the agent's max-byte
contract is enforced by the tool schema, not the IPC layer.

**Rationale**: separating preview from full-read keeps the IPC honest —
file-tree preview never accidentally pulls a 50 MB tool result through
IPC if a future caller forgets the JS-side slice.

Capability allowlist update: `permissions/fs-shell.toml` adds
`project_read_file_preview` to the trusted-host allowlist;
`capabilities/fs-shell.json` doesn't change (capability already covers
the command family).

### Decision 7: `ProjectWorkspaceFiles` selection state machine

Replace 5 scalar `useState`s (`selectedFile`, `preview`, `previewLoading`,
`error` for selection, `error` for directory) with a single reducer:

```ts
type Selection =
  | null
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; path: string; preview: string; truncated: boolean; totalSize: number }
  | { kind: 'error'; path: string; message: string };
```

Directory error stays separate (`directoryError: string | null`). `useReducer`
with three actions: `select(path)`, `previewLoaded(path, preview, truncated, totalSize)`,
`previewFailed(path, message)`. Removes the always-cleared-together
coupling and makes invalid intermediate states unrepresentable.

### Decision 8: Drop the `<ProjectWorkspaceFiles key={...}>` wrapper

Currently `ProjectListPanel` renders `<ProjectWorkspaceFiles
key={projectId}:{workspaceRoot} workspaceRoot={workspaceRoot} />` — the
`key=` change forces React to unmount + remount on every project switch.
The component already resets internal state correctly when `workspaceRoot`
prop changes (the dir-list effect's `[workspaceRoot, ...]` dep). The
`key=` is redundant and additionally causes blow-away on parent re-renders
that happen to compute a different `workspaceRoot` reference for the same
value (e.g. project list refetch returning a new row object).

Drop the `key=` prop. Add `useEffect` inside `ProjectWorkspaceFiles` that
resets `currentPath` to `''` and clears selection when `workspaceRoot`
changes. Same UX behavior on project switch (state resets), but stable
across cosmetic re-renders.

## Risks / Trade-offs

[Risk] Tightening the routing trigger may accidentally exclude a real
local-tool request that was matching by bare-noun before.
→ Mitigation: deterministic harness scenarios (`a-routing-rejects-prose`,
`b-routing-accepts-imperative`) seed the false-positive corpus from agent
feedback (`describe the workspace`, `file a bug`, `请发个文件`) AND a
true-positive corpus from existing R3 traces (`read README.md`, `运行
pnpm typecheck`, `write a scratch note`). Live verification: in direct
chat with an external A2A employee, send `请描述一下当前 workspace
是什么` — must NOT fail-fast.

[Risk] `task.assignment.rerouted` event introduces noise in activity feed
for legitimate rebinds (e.g. employee deleted between plan generation and
dispatch).
→ Mitigation: severity is informational, not warning. Activity feed
collapses runs of identical reason+source under a count badge after 3
occurrences.

[Risk] `project_read_file_preview` UTF-8 boundary walk could silently
return an empty string for files where the first `max_bytes` are entirely
mid-codepoint (extreme edge case for multi-byte-only encoding).
→ Mitigation: if the boundary walk fails, return `truncated: true` with
`content: ''` and surface the message at UI level. Test fixture: file
with all 4-byte UTF-8 codepoints, `max_bytes=3`.

[Risk] Removing `<ProjectWorkspaceFiles key=>` could re-introduce a
pre-existing UX bug where stale state from project A bleeds into project
B if the prop-change effect doesn't fire.
→ Mitigation: explicit `useEffect` resets `currentPath`/selection on
`workspaceRoot` change, AND the directory-list effect's deps already
include `workspaceRoot` so re-fetch happens. Live verify: switch between
two projects rapidly, confirm tree always shows the active project's
root, no flash of previous tree.

[Trade-off] Storing `taskToolIntent` on graph state grows the checkpoint
payload by ~80 bytes per turn (4 booleans + a string-array for
needsBuckets). At ~1 KB/turn average that's <10% growth.
→ Acceptable. SQLite checkpoint payloads are already in the 1–10 KB
range; this is below noise.

## Migration Plan

Pre-launch — no migration. The change deletes `local-tool-routing.ts`
exports outright, replaces `evidenceToolsForTask` calls with
`state.taskToolIntent` reads, and adds `taskToolIntent: null` to
`createEmptyPlanScopedState()` so existing in-flight checkpoints (none in
production) safely default to "no intent computed yet" — boss-node will
populate on next turn.

Tauri release verification rebuild required (capabilities/permissions
change for the new `project_read_file_preview` command). Bundle the
desktop release as part of this change; web build picks up the rest.
