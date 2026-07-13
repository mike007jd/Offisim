import { useUiState, type StageOpenTab, type StageSessionScope } from '@/app/ui-state.js';
import { invokeCommand, type NativeStageSessionScope } from '@/lib/tauri-commands.js';
import { useEffect, useRef } from 'react';

function nativeScope(scope: StageSessionScope): NativeStageSessionScope {
  return scope;
}

export function stageSessionScopeKey(scope: StageSessionScope): string {
  return JSON.stringify([scope.companyId, scope.projectId, scope.threadId ?? null]);
}

function scopeForTab(tab: StageOpenTab): StageSessionScope | null {
  return tab.target.kind === 'terminal-session' || tab.target.kind === 'browser-session'
    ? tab.target.scope
    : null;
}

export interface StageSessionReconciliationPlan {
  closeTerminalIds: string[];
  closeBrowserIds: string[];
  browserVisibility: Array<{ sessionId: string; visible: boolean }>;
}

export function planStageSessionReconciliation(input: {
  tabs: readonly StageOpenTab[];
  nativeTerminalIds: readonly string[];
  nativeBrowserIds: readonly string[];
  visibleTabIds: ReadonlySet<string>;
}): StageSessionReconciliationPlan {
  const terminalIds = new Set(
    input.tabs.flatMap((tab) =>
      tab.target.kind === 'terminal-session' ? [tab.target.sessionId] : [],
    ),
  );
  const browserTabBySession = new Map(
    input.tabs.flatMap((tab) =>
      tab.target.kind === 'browser-session' ? [[tab.target.sessionId, tab.id] as const] : [],
    ),
  );
  return {
    closeTerminalIds: input.nativeTerminalIds.filter((sessionId) => !terminalIds.has(sessionId)),
    closeBrowserIds: input.nativeBrowserIds.filter(
      (sessionId) => !browserTabBySession.has(sessionId),
    ),
    browserVisibility: input.nativeBrowserIds.flatMap((sessionId) => {
      const tabId = browserTabBySession.get(sessionId);
      return tabId
        ? [{ sessionId, visible: input.visibleTabIds.has(tabId) }]
        : [];
    }),
  };
}

/**
 * Reconciles renderer tabs with long-lived native Stage sessions. Tab content
 * can unmount while inactive or split, so native cleanup cannot be delegated
 * to an individual Browser/Terminal component's React cleanup.
 */
export function StageSessionReconciler() {
  const stageOpenTabs = useUiState((state) => state.stageOpenTabs);
  const activeStageTabId = useUiState((state) => state.activeStageTabId);
  const stageSplitTabId = useUiState((state) => state.stageSplitTabId);
  const stagePrimaryTab = useUiState((state) => state.stagePrimaryTab);
  const knownScopesRef = useRef(new Map<string, StageSessionScope>());

  useEffect(() => {
    const visibleBrowserTabIds = new Set(
      stagePrimaryTab === 'game' || stagePrimaryTab === 'board'
        ? []
        : [activeStageTabId, stageSplitTabId].filter((id): id is string => Boolean(id)),
    );
    const liveScopes = new Map<string, StageSessionScope>();
    for (const tab of stageOpenTabs) {
      const scope = scopeForTab(tab);
      if (scope) liveScopes.set(stageSessionScopeKey(scope), scope);
    }
    const scopesToReconcile = new Map(knownScopesRef.current);
    for (const [key, scope] of liveScopes) scopesToReconcile.set(key, scope);
    knownScopesRef.current = scopesToReconcile;

    let cancelled = false;
    void (async () => {
      await Promise.all(
        [...scopesToReconcile].map(async ([scopeKey, scope]) => {
          const [terminal, browser] = await Promise.all([
            invokeCommand('terminal_session_list_scoped', { scope: nativeScope(scope) }).catch(
              () => [],
            ),
            invokeCommand('browser_session_list_scoped', { scope: nativeScope(scope) }).catch(
              () => [],
            ),
          ]);
          if (cancelled) return;
          const tabs = stageOpenTabs.filter((tab) => {
            const tabScope = scopeForTab(tab);
            return tabScope ? stageSessionScopeKey(tabScope) === scopeKey : false;
          });
          const plan = planStageSessionReconciliation({
            tabs,
            nativeTerminalIds: terminal.map((session) => session.sessionId),
            nativeBrowserIds: browser.map((session) => session.sessionId),
            visibleTabIds: visibleBrowserTabIds,
          });
          await Promise.allSettled([
            ...plan.closeTerminalIds.map((sessionId) =>
              invokeCommand('terminal_session_close', {
                sessionId,
                scope: nativeScope(scope),
              }),
            ),
            ...plan.closeBrowserIds.map((sessionId) =>
              invokeCommand('browser_session_close', {
                sessionId,
                scope: nativeScope(scope),
              }),
            ),
            ...plan.browserVisibility.map((visibility) =>
              invokeCommand('browser_session_set_visible', {
                sessionId: visibility.sessionId,
                scope: nativeScope(scope),
                visible: visibility.visible,
              }),
            ),
          ]);
          if (!cancelled && !liveScopes.has(scopeKey)) {
            knownScopesRef.current.delete(scopeKey);
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStageTabId, stageOpenTabs, stagePrimaryTab, stageSplitTabId]);

  useEffect(
    () => () => {
      for (const scope of knownScopesRef.current.values()) {
        void invokeCommand('browser_session_list_scoped', { scope: nativeScope(scope) })
          .then((sessions) =>
            Promise.allSettled(
              sessions.map((session) =>
                invokeCommand('browser_session_set_visible', {
                  sessionId: session.sessionId,
                  scope: nativeScope(scope),
                  visible: false,
                }),
              ),
            ),
          )
          .catch(() => {});
      }
    },
    [],
  );

  return null;
}
