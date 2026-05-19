import { isTauri } from '@offisim/ui-office/web';
import { useEffect, useState } from 'react';

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function useGitBranch(
  workspaceRoot: string | null | undefined,
  projectId: string | null | undefined,
): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceRoot || !projectId || !isTauri()) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
        const result = await invoke<GitExecResult>('git_exec', {
          args: ['rev-parse', '--abbrev-ref', 'HEAD'],
          cwd: '.',
          projectId,
        });
        if (cancelled) return;
        if (!result.ok) {
          setBranch(null);
          return;
        }
        const name = result.stdout.trim();
        setBranch(name && name !== 'HEAD' ? name : null);
      } catch {
        if (!cancelled) setBranch(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, projectId]);

  return branch;
}
