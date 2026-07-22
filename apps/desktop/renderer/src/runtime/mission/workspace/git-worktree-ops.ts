import { invokeCommand } from '@/lib/tauri-commands.js';
import type { GitWorktreeOps, MergeResult } from '@offisim/core/browser';
import { parseNulPathList, parsePorcelainV1ZPaths } from '../git-porcelain.js';

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

function quoteGitDiffPath(path: string): string {
  return /[\\"\t\n\r]/u.test(path) ? JSON.stringify(path) : path;
}

function untrackedTextDiff(path: string, content: string): string {
  const normalized = content.replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const oldPath = quoteGitDiffPath(`a/${path}`);
  const newPath = quoteGitDiffPath(`b/${path}`);
  const headers = [
    `diff --git ${oldPath} ${newPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ ${newPath}`,
  ];
  if (lines.length === 0) return `${headers.join('\n')}\n`;
  const body = lines.map((line) => `+${line}`).join('\n');
  const missingFinalNewline = normalized.endsWith('\n') ? '' : '\n\\ No newline at end of file';
  return `${headers.join('\n')}\n@@ -0,0 +1,${lines.length} @@\n${body}${missingFinalNewline}\n`;
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

    async addWorktree(_branch, _path, _provenance): Promise<void> {
      throw new Error(
        'Workspace leases are created by the bound task runtime; the renderer cannot mint them.',
      );
    },

    async removeWorktree(path: string): Promise<void> {
      const leaseId = path.split('/').filter(Boolean).at(-1);
      if (!leaseId) throw new Error('Workspace lease path has no lease id.');
      await invokeCommand('workspace_lease_release', { projectId, leaseId, path });
    },

    async discardWorktree(path: string): Promise<void> {
      const leaseId = path.split('/').filter(Boolean).at(-1);
      if (!leaseId) throw new Error('Workspace lease path has no lease id.');
      await invokeCommand('workspace_lease_discard', { projectId, leaseId, path });
    },

    async worktreeChanged(path: string): Promise<boolean> {
      const leaseId = path.split('/').filter(Boolean).at(-1);
      if (!leaseId) return true;
      // Backend truth includes both dirty files and clean commits that have not
      // yet landed in the Project checkout. On failure conservatively retain.
      try {
        return await invokeCommand('workspace_lease_changed', { projectId, leaseId, path });
      } catch {
        return true;
      }
    },

    async diff(path: string): Promise<string[]> {
      const base = await rootHead();
      const [committed, workingTree] = await Promise.all([
        run(['diff', '--name-only', '-z', base, 'HEAD'], path),
        run(['status', '--porcelain=v1', '-z'], path),
      ]);
      if (!committed.ok) throw new Error(`git diff failed: ${committed.stderr.trim()}`);
      if (!workingTree.ok) throw new Error(`git status failed: ${workingTree.stderr.trim()}`);
      return [
        ...new Set([
          ...parseNulPathList(committed.stdout),
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
      const trackedDiff = results
        .map((result) => result.stdout.trimEnd())
        .filter(Boolean)
        .join('\n');
      if (trackedDiff) return trackedDiff;
      try {
        const content = await invokeCommand('project_read_file', {
          projectId,
          path: `${path.replace(/\/+$/u, '')}/${changedPath}`,
        });
        return untrackedTextDiff(changedPath, content);
      } catch {
        // Binary, oversized, or concurrently removed untracked files remain in
        // changedPaths but do not make the whole review surface unavailable.
        return '';
      }
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

    async createCheckpoint(): Promise<never> {
      throw new Error('Workspace checkpoints are created by the bound task runtime.');
    },

    async listCheckpoints(path, leaseId) {
      const timeline = await invokeCommand('workspace_checkpoint_timeline', { projectId });
      return timeline.checkpoints.filter(
        (checkpoint) => checkpoint.leaseId === leaseId && checkpoint.cwd === path,
      );
    },

    async rollbackCheckpoint(path, checkpoint, actor) {
      return invokeCommand('workspace_checkpoint_rollback', {
        projectId,
        leaseId: checkpoint.leaseId,
        path,
        checkpointId: checkpoint.checkpointId,
        actor,
      });
    },

    async merge(branch: string): Promise<MergeResult> {
      // A non-ok result with conflict markers in stderr/stdout is reported as a
      // conflict (NOT an overwrite — the manager surfaces it).
      try {
        const result = await run(['merge', '--no-ff', branch], null);
        if (result.ok) return { ok: true, conflicts: [] };
        const conflicts = await run(['diff', '--name-only', '--diff-filter=U', '-z'], null);
        if (!conflicts.ok) {
          throw new Error(conflicts.stderr.trim() || 'Could not inspect merge conflicts.');
        }
        const paths = parseNulPathList(conflicts.stdout);
        if (paths.length === 0) {
          throw new Error(result.stderr.trim() || result.stdout.trim() || 'Git merge failed.');
        }
        return { ok: false, conflicts: paths };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A thrown invoke is reported as a conflict-less failure so the manager
        // stops and surfaces it — never an overwrite.
        return { ok: false, conflicts: [`merge failed: ${message}`] };
      }
    },
  };
}
