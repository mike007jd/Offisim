import type { ChatThreadRepository } from '@offisim/core/browser';
import { useEffect, useRef } from 'react';
import type { UpdateWorkspaceStateFn } from '../components/workspaces/types';

export interface ThreadBootstrapDeps {
  chatThreads: ChatThreadRepository | null;
  activeProjectId: string | null;
  selectedThreadId: string | null;
  updateWorkspaceState: UpdateWorkspaceStateFn;
}

export function useThreadBootstrap(deps: ThreadBootstrapDeps): void {
  const { chatThreads, activeProjectId, selectedThreadId, updateWorkspaceState } = deps;

  const selectedRef = useRef(selectedThreadId);
  selectedRef.current = selectedThreadId;

  useEffect(() => {
    if (!chatThreads) return;
    if (!activeProjectId) return;

    let cancelled = false;
    const projectId = activeProjectId;

    void (async () => {
      try {
        const ensured = await chatThreads.ensureProjectHasAtLeastOneThread(projectId);
        if (cancelled) return;
        const current = selectedRef.current;
        if (current !== null) {
          const row = await chatThreads.findById(current);
          if (cancelled) return;
          if (row && row.project_id === projectId && row.archived_at === null) return;
        }
        updateWorkspaceState('office', (prev) =>
          prev.selectedThreadId === ensured.thread_id
            ? prev
            : { ...prev, selectedThreadId: ensured.thread_id },
        );
      } catch (err) {
        console.warn('[thread-bootstrap] failed to ensure default thread', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatThreads, activeProjectId, updateWorkspaceState]);
}
