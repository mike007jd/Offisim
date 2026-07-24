import {
  type BrowserSessionSnapshot,
  type NativeStageSessionScope,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { type UnlistenFn, listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export const BROWSER_SESSION_EVENT = 'offisim-browser-session-event-v1';

function sameScope(left: NativeStageSessionScope, right: NativeStageSessionScope): boolean {
  return (
    left.companyId === right.companyId &&
    left.projectId === right.projectId &&
    left.threadId === right.threadId
  );
}

function activeAgentSessions(sessions: readonly BrowserSessionSnapshot[]) {
  return sessions
    .filter((session) => session.agent && session.status !== 'closed')
    .sort((left, right) => right.sequence - left.sequence);
}

export function useAgentBrowserSessions(scope: NativeStageSessionScope | null) {
  const [sessions, setSessions] = useState<BrowserSessionSnapshot[]>([]);
  const companyId = scope?.companyId;
  const projectId = scope?.projectId;
  const threadId = scope?.threadId;

  useEffect(() => {
    if (!companyId || !projectId || !threadId) {
      setSessions([]);
      return;
    }
    const currentScope = { companyId, projectId, threadId };
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    const refresh = async () => {
      const listed = await invokeCommand('browser_session_list_scoped', { scope: currentScope });
      if (!cancelled) setSessions(activeAgentSessions(listed));
    };
    void (async () => {
      try {
        const stop = await listen<BrowserSessionSnapshot>(BROWSER_SESSION_EVENT, ({ payload }) => {
          if (cancelled || !sameScope(payload.scope, currentScope)) return;
          setSessions((current) =>
            activeAgentSessions([
              ...current.filter((session) => session.sessionId !== payload.sessionId),
              payload,
            ]),
          );
        });
        if (cancelled) stop();
        else unlisten = stop;
        await refresh();
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [companyId, projectId, threadId]);

  return sessions;
}
