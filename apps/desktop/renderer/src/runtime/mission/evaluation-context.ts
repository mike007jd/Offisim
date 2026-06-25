import type { EvaluationContext } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';

// Lazy Tauri import (mirrors git-workbench / ensure-default-workspace): keeping it
// out of module scope means a Node harness can import this module — and the
// MissionRunController that depends on it — without resolving `@tauri-apps/api`.
// In the live `.app` it resolves immediately on first capability call.
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeImpl: Invoke | null = null;
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    const mod = await import('@tauri-apps/api/core');
    invokeImpl = mod.invoke as Invoke;
  }
  return invokeImpl<T>(cmd, args);
}

/**
 * Tauri-backed {@link EvaluationContext} (PRD §14.2 / §20.3, slice MS-005).
 *
 * This is the production binding of the MS-003 evaluator capability surface: every
 * method is backed by a sandboxed Tauri command (Rust path-jail, shell classifier,
 * timeout, output cap, redaction). The evaluator (pure logic) reads the workspace
 * ONLY through these methods — it never constructs its own fs/shell/git access
 * (§14.2.2). Per the contract, a capability that cannot serve a request returns a
 * safe sentinel (`null` / `false` / `classifierBlocked: true`) instead of throwing,
 * so the evaluator maps it to a verdict rather than crashing.
 *
 * The evaluator runs over REAL workspace state — NOT the agent's self-reported
 * verdict. The agent's `submit_for_evaluation` is only a SIGNAL that a criterion is
 * ready; this context is how the deterministic evaluator independently verifies it
 * (§5).
 */

/** A criterion in the controller's minimal view, narrowed to what the context
 *  needs (id / description / config). Matches `ControllerCriterion`'s shape. */
export interface EvaluationCriterionView {
  id: string;
  description: string;
  configJson: string;
}

export interface TauriEvaluationContextInput {
  /** The selected project's id — scopes every sandboxed command to its workspace. */
  projectId: string | null;
  /** The project's on-disk `workspace_root` — the cwd for the bash builtin. Null
   *  when unbound, in which case `runCommand` degrades to a classifier-style block
   *  so the command criterion ERRORs rather than silently passing. */
  workspaceRoot: string | null;
  /** The criterion under evaluation (id + description + declarative config). */
  criterion: EvaluationCriterionView;
  /** The attempt's run id — the `run_id` published artifacts are tagged with. */
  attemptRunId: string;
  /** Runtime repos — `deliverables.listByRunId` backs `listArtifacts`. */
  repos: RuntimeRepositories;
}

/**
 * Mirrors the Rust `bash_execute` command's `BashExecuteResult` struct, which is
 * `#[serde(rename_all = "camelCase")]` (apps/desktop/src-tauri/src/builtin_tools.rs)
 * — so the IPC wire delivers camelCase keys (`exitCode`, `timedOut`). Reading
 * snake_case here would yield `undefined` → coerce to exit 0 → every
 * command_exit_zero criterion would falsely PASS regardless of the real exit
 * code (the same IPC-boundary class as the VM-003/RD usage-drop bug). Only the
 * fields the evaluator reads are declared.
 */
interface BashExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const BASH_TIMEOUT_MS = 120_000;

/**
 * Build the production EvaluationContext for one criterion of one attempt. Each
 * capability is a thin adapter over the same sandboxed Tauri commands the file
 * browser / git workbench use.
 */
export function createTauriEvaluationContext(input: TauriEvaluationContextInput): EvaluationContext {
  const { projectId, workspaceRoot, criterion, attemptRunId, repos } = input;

  return {
    criterion: {
      id: criterion.id,
      description: criterion.description,
      configJson: criterion.configJson,
    },

    async workspaceReadFile(path: string): Promise<string | null> {
      // `project_read_file`'s `projectId` is Option on the Rust side: a null id
      // makes it search ALL workspace roots, so a criterion could be satisfied by
      // a file in a DIFFERENT project. Scope the evaluator to its own project —
      // no project → null (file_hash/json_schema → ERROR, text_contains → FAIL),
      // matching runCommand's guard.
      if (!projectId) return null;
      try {
        return await tauriInvoke<string>('project_read_file', { path, projectId });
      } catch {
        // Out-of-jail / missing / unreadable — the contract sentinel is null.
        return null;
      }
    },

    async workspaceFileExists(path: string): Promise<boolean> {
      // Scope to this project (see workspaceReadFile) — a null project id would
      // let a file in another project satisfy the criterion → false here.
      if (!projectId) return false;
      // A cheap existence probe: the sandboxed read rejects an out-of-jail or
      // missing path, so a non-throwing read means the file is present + in-jail.
      // (project_read_file has an 8 MB cap, which is acceptable for an existence
      // check on workspace files an evaluator asserts on.)
      try {
        await tauriInvoke<string>('project_read_file', { path, projectId });
        return true;
      } catch {
        return false;
      }
    },

    async workspaceHashFile(path: string): Promise<string | null> {
      // Scope to this project (see workspaceReadFile) — a null project id would
      // hash a file from another project → null here (→ file_hash ERROR).
      if (!projectId) return null;
      // Read through the sandbox, then hash in-renderer with WebCrypto — the same
      // sha256 hashing the artifact-persist path uses, so a file_hash criterion
      // and a published artifact's content_hash agree byte-for-byte.
      let content: string;
      try {
        content = await tauriInvoke<string>('project_read_file', { path, projectId });
      } catch {
        return null;
      }
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        return Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch {
        return null;
      }
    },

    async runCommand(
      command: string,
    ): Promise<{ exitCode: number; stdout: string; stderr: string; classifierBlocked?: boolean }> {
      // No workspace root → nothing to run against. Treat as a classifier-style
      // block so the evaluator maps it to ERROR (a setup problem), not FAIL.
      if (!workspaceRoot || !projectId) {
        return {
          exitCode: -1,
          stdout: '',
          stderr: 'no workspace_root bound for this project',
          classifierBlocked: true,
        };
      }
      try {
        const result = await tauriInvoke<BashExecuteResult>('bash_execute', {
          cwd: workspaceRoot,
          cmd: command,
          timeoutMs: BASH_TIMEOUT_MS,
          maxOutputBytes: null,
          projectId,
          approvalId: null,
          employeeId: null,
          networkPolicy: null,
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (err) {
        // A thrown invoke is either the Rust shell classifier rejecting a denied
        // command ("bash_execute rejected: ...") or some other invoke failure
        // (timeout, spawn error, missing project). Either way map it to the
        // contract's classifierBlocked sentinel so the evaluator ERRORs (a
        // setup/policy problem) instead of the whole attempt throwing — a thrown
        // capability must never crash the deterministic loop. The distinction
        // (true classifier block vs other failure) is preserved in stderr.
        const message = err instanceof Error ? err.message : String(err);
        return {
          exitCode: -1,
          stdout: '',
          stderr: message,
          classifierBlocked: true,
        };
      }
    },

    async gitChangedPaths(): Promise<string[]> {
      if (!projectId) return [];
      try {
        const result = await tauriInvoke<GitExecResult>('git_exec', {
          projectId,
          args: ['status', '--porcelain'],
          cwd: null,
        });
        if (!result.ok) return [];
        return parsePorcelainPaths(result.stdout);
      } catch {
        // Non-git workspace / git unavailable — no changed paths to report.
        return [];
      }
    },

    async listArtifacts(): Promise<Array<{ kind: string; title: string; contentHash: string }>> {
      const repo = repos.deliverables;
      if (!repo) return [];
      try {
        const rows = await repo.listByRunId(attemptRunId);
        return rows.map((row) => ({
          kind: row.kind ?? '',
          title: row.title,
          contentHash: row.content_hash ?? '',
        }));
      } catch {
        return [];
      }
    },

    async recordedApproval(): Promise<{ approved: boolean; approver?: string } | null> {
      // DEFERRED (MS-005): there is no mission-approval UI until M3. With no
      // recorded approval, a `manual_approval` criterion's evaluator maps null →
      // BLOCKED, which the loop controller treats as infra (no repair consumed) —
      // the honest outcome until the approval surface exists. Do NOT fabricate an
      // approval here; that would defeat §5's external-acceptance guarantee.
      return null;
    },
  };
}

/**
 * Parse `git status --porcelain` output into the changed paths relative to the
 * workspace root. Handles staged/unstaged markers (the first two columns) and
 * rename arrows (`R  old -> new` → the new path), mirroring the git-workbench
 * porcelain parser's path extraction.
 */
function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith('##')) continue;
    // Porcelain v1: 2 status columns + a space, then the path.
    const pathPart = line.slice(3).trim();
    if (!pathPart) continue;
    const path = pathPart.includes(' -> ') ? (pathPart.split(' -> ').at(-1) ?? pathPart) : pathPart;
    if (path) paths.push(path);
  }
  return paths;
}
