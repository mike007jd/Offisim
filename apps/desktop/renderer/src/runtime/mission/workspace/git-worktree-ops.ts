import { invokeCommand } from '@/lib/tauri-commands.js';
import type { GitWorktreeOps, MergeResult } from '@offisim/core/browser';
import { parsePorcelainV1ZPaths } from '../git-porcelain.js';

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
 * F2 makes `worktree` and `merge --no-ff` live in `git.rs` behind the same path
 * jail. Per-child allocation now happens host-side; this adapter remains the
 * renderer/review binding for explicit diff and integration surfaces.
 */

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
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
    return invokeCommand('git_exec', { projectId, args, cwd });
  }

  async function rootHead(): Promise<string> {
    const result = await run(['rev-parse', 'HEAD'], null);
    const head = result.stdout.trim();
    if (!result.ok || !/^[0-9a-f]{40}$/i.test(head)) {
      throw new Error(`Could not resolve the project HEAD: ${result.stderr.trim()}`);
    }
    return head;
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
      const result = await run(['worktree', 'add', '-b', branch, path], null);
      if (!result.ok) {
        throw new Error(`git worktree add failed: ${result.stderr.trim()}`);
      }
    },

    async removeWorktree(path: string): Promise<void> {
      const result = await run(['worktree', 'remove', path], null);
      if (!result.ok) {
        throw new Error(`git worktree remove failed: ${result.stderr.trim()}`);
      }
    },

    async discardWorktree(path: string): Promise<void> {
      const leaseId = path.split('/').filter(Boolean).at(-1);
      if (!leaseId) throw new Error('Workspace lease path has no lease id.');
      await invokeCommand('workspace_lease_discard', { projectId, leaseId });
    },

    async worktreeChanged(path: string): Promise<boolean> {
      // Already-whitelisted (`status --porcelain`) run IN the worktree cwd: any
      // non-empty porcelain line means the worktree has changes. On failure we
      // conservatively report `true` so cleanup RETAINS rather than risk
      // discarding unverified work (WI-006 data safety — never silently discard).
      try {
        const result = await run(['status', '--porcelain=v1', '-z'], path);
        if (!result.ok) return true;
        return parsePorcelainV1ZPaths(result.stdout).length > 0;
      } catch {
        return true;
      }
    },

    async diff(path: string): Promise<string[]> {
      const base = await rootHead();
      const [committed, workingTree] = await Promise.all([
        run(['diff', '--name-only', base, 'HEAD'], path),
        run(['status', '--porcelain=v1', '-z'], path),
      ]);
      if (!committed.ok) throw new Error(`git diff failed: ${committed.stderr.trim()}`);
      if (!workingTree.ok) throw new Error(`git status failed: ${workingTree.stderr.trim()}`);
      return [
        ...new Set([
          ...parseLinePaths(committed.stdout),
          ...parsePorcelainV1ZPaths(workingTree.stdout),
        ]),
      ];
    },

    async diffText(path: string, changedPath: string): Promise<string> {
      const base = await rootHead();
      const results = await Promise.all([
        run(['diff', '--unified=3', base, 'HEAD', '--', changedPath], path),
        run(['diff', '--cached', '--unified=3', '--', changedPath], path),
        run(['diff', '--unified=3', '--', changedPath], path),
      ]);
      const failed = results.find((result) => !result.ok);
      if (failed) throw new Error(`git diff failed: ${failed.stderr.trim()}`);
      return results
        .map((result) => result.stdout.trimEnd())
        .filter(Boolean)
        .join('\n');
    },

    async commitAll(path: string, message: string): Promise<void> {
      // The whitelist takes explicit pathspecs only (no `add -A`), so stage
      // exactly what porcelain reports. No-op on a clean worktree.
      const status = await run(['status', '--porcelain=v1', '-z'], path);
      if (!status.ok) throw new Error(`git status failed: ${status.stderr.trim()}`);
      const paths = parsePorcelainV1ZPaths(status.stdout);
      if (paths.length === 0) return;
      const add = await run(['add', '--', ...paths], path);
      if (!add.ok) throw new Error(`git add failed: ${add.stderr.trim()}`);
      const commit = await run(['commit', '-m', message], path);
      if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr.trim()}`);
    },

    async merge(branch: string): Promise<MergeResult> {
      // A non-ok result with conflict markers in stderr/stdout is reported as a
      // conflict (NOT an overwrite — the manager surfaces it).
      try {
        const result = await run(['merge', '--no-ff', branch], null);
        if (result.ok) return { ok: true, conflicts: [] };
        return { ok: false, conflicts: parseMergeConflicts(result.stdout, result.stderr) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A thrown invoke is reported as a conflict-less failure so the manager
        // stops and surfaces it — never an overwrite.
        return { ok: false, conflicts: [`merge failed: ${message}`] };
      }
    },
  };
}

function parseLinePaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
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
