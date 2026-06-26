# Integration and Native Cleanup

Integration and cleanup are part of the development outcome, not optional administration.

## Integration path

Prefer:

`isolated writer result → independent review → integration head → integration verification → target branch/PR → target-revision verification`

Use the current harness's native handoff, worktree, commit, branch, and PR flow. Do not impose a custom branch manager when the harness already manages detached worktrees, snapshots, or handoff.

Integrate by dependency wave so interface and conflict problems appear early.

## Before accepting a worker result

Confirm:

- scope matches assignment;
- changed files and behavior are understood;
- task-local evidence passes;
- independent review is complete;
- integration notes and dependencies are explicit;
- the result is preserved as a commit, diff, handoff, snapshot, or equivalent native artifact.

Then consume the result and close/archive the worker rather than leaving it idle.

## Before target merge

Confirm:

- all required gates pass at one known integration revision;
- the target branch has not invalidated assumptions;
- branch protection and repository policy are respected;
- merge authority is present;
- rollback or repair is possible.

## After target merge

Verify the actual target revision. Only after this passes should temporary recovery branches and worktrees be released.

## Agent lifecycle cleanup

Use native lifecycle controls to:

- stop duplicate or superseded agents;
- close completed subagents;
- shut down teammates/teams when supported;
- archive or close background sessions;
- ensure descendant sessions do not remain active unintentionally.

The skill may inspect native agent views or task state, but must not create its own agent process manager.

## Worktree cleanup

Use native managed-worktree cleanup first. Different harnesses may automatically remove, snapshot, retain, or archive worktrees. Respect that behavior.

Before removal:

- accepted work is integrated or safely handed off;
- rejected work with durable value has a concise archived finding;
- unknown user edits are preserved;
- any runtime process launched from the worktree is stopped.

After removal, inspect for leftovers attributable to the run. Use ordinary Git cleanup only as a fallback for user-created resources the harness does not manage.

## Codebase cleanup

Run a bounded gardener pass for artifacts introduced by the work:

- debug output;
- temporary flags;
- unused dependencies/imports;
- duplicated or superseded helpers;
- obsolete scaffolding;
- stale comments;
- accidental generated files.

Do not use cleanup as permission for unrelated architectural rewriting.

## Completion statement

The final report should explicitly state:

- target revision or PR path;
- verification status;
- agent/session lifecycle status;
- worktree/temporary branch status;
- runtime resource status;
- any intentionally retained resource, owner, and reason.
