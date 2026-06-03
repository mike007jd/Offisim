import type { ShellExec, ShellExecResult } from '@offisim/core/tools';

/** Raw shape returned by the Rust `bash_execute` command (camelCase over IPC). */
interface BashExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * `ShellExec` backed by the sandboxed Tauri `bash_execute` command.
 *
 * The Rust side (`apps/desktop/src-tauri/src/builtin_tools.rs`) REQUIRES a
 * non-empty `projectId` and a `cwd` that canonicalizes inside that project's
 * bound `workspace_root`; it refuses anything else. So this adapter fails closed
 * when no project is bound — shell only runs against a real workspace, never the
 * app process cwd — and defaults `cwd` to the project root when the model did
 * not pin one. We never widen the Rust sandbox; out-of-bounds paths are rejected
 * Rust-side and surface as a tool error the employee explains honestly.
 *
 * `resolveProjectRoot` reads the bound folder from the project repository (the
 * same `projects.workspace_root` the Rust command validates against).
 */
export function createTauriShellExecAdapter(options: {
  resolveProjectRoot: (projectId: string) => Promise<string | null>;
}): ShellExec {
  return async (command, opts): Promise<ShellExecResult> => {
    const projectId = opts.projectId?.trim();
    if (!projectId) {
      throw new Error(
        'Shell commands need a bound project workspace. Bind a project folder to this chat before running shell commands.',
      );
    }
    const root = await options.resolveProjectRoot(projectId);
    if (!root) {
      throw new Error(
        'The bound project has no workspace folder. Bind a folder before running shell commands.',
      );
    }

    // Default cwd to the project root; resolve a model-supplied relative cwd
    // against that root (Rust canonicalizes, which would otherwise resolve a
    // bare relative path against the app process cwd and escape the sandbox).
    let cwd = opts.cwd?.trim();
    if (!cwd) {
      cwd = root;
    } else if (!cwd.startsWith('/')) {
      cwd = `${root.replace(/\/+$/, '')}/${cwd.replace(/^\/+/, '')}`;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<BashExecuteResult>('bash_execute', {
      cwd,
      cmd: command,
      timeoutMs: opts.timeoutMs ?? 30_000,
      ...(opts.maxOutputBytes ? { maxOutputBytes: opts.maxOutputBytes } : {}),
      projectId,
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  };
}
