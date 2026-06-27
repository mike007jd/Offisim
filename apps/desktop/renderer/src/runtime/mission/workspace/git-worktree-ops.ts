import type { GitWorktreeOps, MergeResult } from '@offisim/core/browser';

/**
 * Tauri-backed {@link GitWorktreeOps} (PRD §23.3 / §14.2, slice M5 — WI-002/004/005/006).
 *
 * This is the PRODUCTION binding of the deterministic WorkspaceLeaseManager's
 * injected git surface: every method is backed by the sandboxed `git_exec` Tauri
 * command (Rust path-jail, subcommand whitelist, timeout, output cap, redaction).
 * The manager (pure logic in `@offisim/core`) drives the workspace ONLY through
 * this adapter — the renderer never spawns git itself (§14.2.2: the renderer must
 * NOT directly execute workspace files / shell / git; Rust/Tauri is the final
 * boundary).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ M5 LIVE-PATH GAP — `git_exec` does NOT whitelist `worktree`, `merge`, or
 * `checkout`.
 *
 * `apps/desktop/src-tauri/src/git.rs` `ALLOWED_SUBCOMMANDS` is currently:
 *   status · add · commit · diff · log · rev-parse · branch · remote · init · clone
 *
 * The lease manager needs `git worktree add` / `git worktree remove`
 * (`addWorktree` / `removeWorktree`) and `git merge` (`merge`). Those subcommands
 * are NOT in the whitelist, so the live calls below will be REJECTED by the Rust
 * gate until a `worktree` (+ `merge`, + the `worktree`/`merge` flags they need)
 * whitelist entry is added in `git.rs`. That is a deliberate Rust security change
 * (new write-capable subcommands behind the path-jail) and is intentionally NOT
 * made here — it is flagged as the M5 LIVE GAP. The deterministic lease logic +
 * the in-memory harness are what M5 verifies now; this adapter is the wiring that
 * becomes live the moment `git.rs` grows the `worktree` / `merge` whitelist.
 *
 * `isGitRepo`, `worktreeChanged`, and `diff` use ALREADY-whitelisted subcommands
 * (`rev-parse` / `status` / `diff`) and work today.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Lazy Tauri import (mirrors evaluation-context / git-workbench): keeping it out
// of module scope means a Node harness can import this module without resolving
// `@tauri-apps/api`. In the live `.app` it resolves on first call.
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeImpl: Invoke | null = null;
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    const mod = await import('@tauri-apps/api/core');
    invokeImpl = mod.invoke as Invoke;
  }
  return invokeImpl<T>(cmd, args);
}

export interface TauriGitWorktreeOpsInput {
  /** The selected project's id — scopes every `git_exec` call to its workspace. */
  projectId: string;
}

/**
 * Build the production GitWorktreeOps for a project. The `path` arguments the
 * manager passes are absolute worktree paths under the project's jailed
 * `.offisim/worktrees/...`; `git_exec`'s `cwd` resolution path-jails them to the
 * bound `workspace_root`.
 */
export function createTauriGitWorktreeOps(input: TauriGitWorktreeOpsInput): GitWorktreeOps {
  const { projectId } = input;

  async function run(args: string[], cwd: string | null): Promise<GitExecResult> {
    return tauriInvoke<GitExecResult>('git_exec', { projectId, args, cwd });
  }

  return {
    async isGitRepo(root: string): Promise<boolean> {
      // Already-whitelisted (`rev-parse --is-inside-work-tree`). A non-git
      // workspace returns a non-ok / throwing result → false.
      try {
        const result = await run(['rev-parse', '--is-inside-work-tree'], root);
        return result.ok && result.stdout.trim() === 'true';
      } catch {
        return false;
      }
    },

    async addWorktree(branch: string, path: string): Promise<void> {
      // ⚠️ M5 LIVE GAP: `git worktree add -b <branch> <path>` — `worktree` is NOT
      // whitelisted in git.rs, so this is rejected until that entry is added.
      const result = await run(['worktree', 'add', '-b', branch, path], null);
      if (!result.ok) {
        throw new Error(
          `git worktree add failed (note: 'worktree' may not be whitelisted in git_exec yet — M5 live gap): ${result.stderr.trim()}`,
        );
      }
    },

    async removeWorktree(path: string): Promise<void> {
      // ⚠️ M5 LIVE GAP: `git worktree remove <path>` — same `worktree` whitelist gap.
      const result = await run(['worktree', 'remove', path], null);
      if (!result.ok) {
        throw new Error(
          `git worktree remove failed (note: 'worktree' may not be whitelisted in git_exec yet — M5 live gap): ${result.stderr.trim()}`,
        );
      }
    },

    async worktreeChanged(path: string): Promise<boolean> {
      // Already-whitelisted (`status --porcelain`) run IN the worktree cwd: any
      // non-empty porcelain line means the worktree has changes. On failure we
      // conservatively report `true` so cleanup RETAINS rather than risk
      // discarding unverified work (WI-006 data safety — never silently discard).
      try {
        const result = await run(['status', '--porcelain'], path);
        if (!result.ok) return true;
        return parsePorcelainPaths(result.stdout).length > 0;
      } catch {
        return true;
      }
    },

    async diff(path: string): Promise<string[]> {
      // Already-whitelisted. `diff --name-only HEAD` would need a revision arg
      // that the whitelist forbids, so we use `status --porcelain` (also the
      // working-tree truth) in the worktree cwd and return its changed paths.
      try {
        const result = await run(['status', '--porcelain'], path);
        if (!result.ok) return [];
        return parsePorcelainPaths(result.stdout);
      } catch {
        return [];
      }
    },

    async merge(branch: string): Promise<MergeResult> {
      // ⚠️ M5 LIVE GAP: `git merge --no-ff <branch>` into the root — `merge` is NOT
      // whitelisted in git.rs, so this is rejected until that entry is added. When
      // it IS whitelisted: a non-ok result with conflict markers in stderr/stdout
      // is reported as a conflict (NOT an overwrite — the manager surfaces it).
      try {
        const result = await run(['merge', '--no-ff', branch], null);
        if (result.ok) return { ok: true, conflicts: [] };
        return { ok: false, conflicts: parseMergeConflicts(result.stdout, result.stderr) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A thrown invoke (incl. the `merge` whitelist rejection) is reported as a
        // conflict-less failure so the manager stops and surfaces it — never an
        // overwrite.
        return { ok: false, conflicts: [`merge failed: ${message}`] };
      }
    },
  };
}

/**
 * Parse `git status --porcelain` output into changed paths relative to the
 * workspace root. Handles staged/unstaged markers and rename arrows
 * (`R old -> new` → the new path). Mirrors the evaluation-context / git-workbench
 * porcelain parsers.
 */
function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith('##')) continue;
    const pathPart = line.slice(3).trim();
    if (!pathPart) continue;
    const path = pathPart.includes(' -> ') ? (pathPart.split(' -> ').at(-1) ?? pathPart) : pathPart;
    if (path) paths.push(path);
  }
  return paths;
}

/**
 * Extract conflicted paths from a failed `git merge`. Git prints
 * `CONFLICT (content): Merge conflict in <path>` lines; pull the paths out so the
 * manager can route the lease to repair/human (§23.3). Falls back to a single
 * opaque marker when no path line is present.
 */
function parseMergeConflicts(stdout: string, stderr: string): string[] {
  const text = `${stdout}\n${stderr}`;
  const conflicts: string[] = [];
  const re = /Merge conflict in (.+)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex exec-loop idiom
  while ((match = re.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) conflicts.push(path);
  }
  return conflicts.length > 0 ? conflicts : ['merge conflict (paths unavailable)'];
}
