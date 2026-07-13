import { type StageOpenTab, type StageSessionScope, useUiState } from '@/app/ui-state.js';
import { type NativeStageSessionScope, invokeCommand } from '@/lib/tauri-commands.js';
import { useEffect, useRef } from 'react';

export type NativeStageSessionKind = 'browser' | 'terminal';

interface NativeStageSessionLeaseRecord {
  generation: number;
  active: boolean;
}

export interface NativeStageSessionLease {
  readonly generation: number;
  isCurrent(): boolean;
  release(): void;
  runIfCurrent<T>(operation: () => Promise<T>): Promise<T | undefined>;
  runIfLatest<T>(operation: () => Promise<T>): Promise<T | undefined>;
}

let nextNativeStageSessionGeneration = 0;
const nativeStageSessionLeases = new Map<string, NativeStageSessionLeaseRecord>();
const nativeStageSessionMutationQueues = new Map<string, Promise<void>>();

function nativeScope(scope: StageSessionScope): NativeStageSessionScope {
  return scope;
}

export function stageSessionScopeKey(scope: StageSessionScope): string {
  return JSON.stringify([scope.companyId, scope.projectId, scope.threadId ?? null]);
}

function nativeStageSessionKey(
  kind: NativeStageSessionKind,
  scope: StageSessionScope,
  sessionId: string,
): string {
  return JSON.stringify([kind, stageSessionScopeKey(scope), sessionId]);
}

function enqueueNativeStageSessionMutation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = nativeStageSessionMutationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  nativeStageSessionMutationQueues.set(key, tail);
  void tail.then(() => {
    if (nativeStageSessionMutationQueues.get(key) === tail) {
      nativeStageSessionMutationQueues.delete(key);
    }
  });
  return result;
}

function cleanReleasedNativeStageSessionLease(
  key: string,
  record: NativeStageSessionLeaseRecord,
): void {
  queueMicrotask(() => {
    const tail = nativeStageSessionMutationQueues.get(key);
    if (tail) {
      void tail.then(() => cleanReleasedNativeStageSessionLease(key, record));
      return;
    }
    if (nativeStageSessionLeases.get(key) === record && !record.active) {
      nativeStageSessionLeases.delete(key);
    }
  });
}

export function nativeStageSessionLeaseRegistrySize(): number {
  return nativeStageSessionLeases.size;
}

export function acquireNativeStageSessionLease(
  kind: NativeStageSessionKind,
  scope: StageSessionScope,
  sessionId: string,
): NativeStageSessionLease {
  const key = nativeStageSessionKey(kind, scope, sessionId);
  const record: NativeStageSessionLeaseRecord = {
    generation: ++nextNativeStageSessionGeneration,
    active: true,
  };
  nativeStageSessionLeases.set(key, record);
  const isLatest = () => nativeStageSessionLeases.get(key) === record;
  const isCurrent = () => isLatest() && record.active;
  const run = <T,>(predicate: () => boolean, operation: () => Promise<T>) =>
    enqueueNativeStageSessionMutation(key, async () => {
      if (!predicate()) return undefined;
      return operation();
    });
  return {
    generation: record.generation,
    isCurrent,
    release() {
      if (!record.active) return;
      record.active = false;
      cleanReleasedNativeStageSessionLease(key, record);
    },
    runIfCurrent: (operation) => run(isCurrent, operation),
    runIfLatest: (operation) => run(isLatest, operation),
  };
}

function hasActiveNativeStageSessionLease(
  kind: NativeStageSessionKind,
  scope: StageSessionScope,
  sessionId: string,
): boolean {
  return (
    nativeStageSessionLeases.get(nativeStageSessionKey(kind, scope, sessionId))?.active === true
  );
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

export interface StageSessionReconciliationCommands {
  listTerminals(scope: StageSessionScope): Promise<readonly { sessionId: string }[]>;
  listBrowsers(scope: StageSessionScope): Promise<readonly { sessionId: string }[]>;
  closeTerminal(scope: StageSessionScope, sessionId: string): Promise<boolean>;
  closeBrowser(scope: StageSessionScope, sessionId: string): Promise<boolean>;
  setBrowserVisible(
    scope: StageSessionScope,
    sessionId: string,
    visible: boolean,
  ): Promise<boolean>;
}

export function stageSessionReconciliationRetryDelay(attempt: number): number {
  return Math.min(4_000, 250 * 2 ** Math.max(0, attempt));
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
      return tabId ? [{ sessionId, visible: input.visibleTabIds.has(tabId) }] : [];
    }),
  };
}

export async function reconcileStageSessionScope(
  input: {
    scope: StageSessionScope;
    tabs: readonly StageOpenTab[];
    visibleTabIds: ReadonlySet<string>;
  },
  commands: StageSessionReconciliationCommands,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  const listed = await Promise.allSettled([
    commands.listTerminals(input.scope),
    commands.listBrowsers(input.scope),
  ]);
  if (!isCurrent() || listed[0].status !== 'fulfilled' || listed[1].status !== 'fulfilled') {
    return false;
  }
  const plan = planStageSessionReconciliation({
    tabs: input.tabs,
    nativeTerminalIds: listed[0].value.map((session) => session.sessionId),
    nativeBrowserIds: listed[1].value.map((session) => session.sessionId),
    visibleTabIds: input.visibleTabIds,
  });
  const operations = await Promise.allSettled([
    ...plan.closeTerminalIds.map((sessionId) => commands.closeTerminal(input.scope, sessionId)),
    ...plan.closeBrowserIds.map((sessionId) => commands.closeBrowser(input.scope, sessionId)),
    ...plan.browserVisibility.map(({ sessionId, visible }) =>
      commands.setBrowserVisible(input.scope, sessionId, visible),
    ),
  ]);
  return (
    isCurrent() &&
    operations.every((result) => result.status === 'fulfilled' && result.value === true)
  );
}

function nativeReconciliationCommands(
  isCurrent: () => boolean,
): StageSessionReconciliationCommands {
  return {
    listTerminals: (scope) =>
      invokeCommand('terminal_session_list_scoped', { scope: nativeScope(scope) }),
    listBrowsers: (scope) =>
      invokeCommand('browser_session_list_scoped', { scope: nativeScope(scope) }),
    closeTerminal: (scope, sessionId) =>
      enqueueNativeStageSessionMutation(
        nativeStageSessionKey('terminal', scope, sessionId),
        async () => {
          if (!isCurrent() || hasActiveNativeStageSessionLease('terminal', scope, sessionId)) {
            return false;
          }
          await invokeCommand('terminal_session_close', {
            sessionId,
            scope: nativeScope(scope),
          });
          return true;
        },
      ),
    closeBrowser: (scope, sessionId) =>
      enqueueNativeStageSessionMutation(
        nativeStageSessionKey('browser', scope, sessionId),
        async () => {
          if (!isCurrent() || hasActiveNativeStageSessionLease('browser', scope, sessionId)) {
            return false;
          }
          await invokeCommand('browser_session_close', {
            sessionId,
            scope: nativeScope(scope),
          });
          return true;
        },
      ),
    setBrowserVisible: (scope, sessionId, visible) =>
      enqueueNativeStageSessionMutation(
        nativeStageSessionKey('browser', scope, sessionId),
        async () => {
          if (!isCurrent()) return false;
          await invokeCommand('browser_session_set_visible', {
            sessionId,
            scope: nativeScope(scope),
            visible,
          });
          return true;
        },
      ),
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
    let retryTimer = 0;
    let retryAttempt = 0;
    const isCurrent = () => !cancelled;
    const commands = nativeReconciliationCommands(isCurrent);
    const reconcile = async (scopes: ReadonlyMap<string, StageSessionScope>) => {
      const failedScopes = new Map<string, StageSessionScope>();
      await Promise.all(
        [...scopes].map(async ([scopeKey, scope]) => {
          const tabs = stageOpenTabs.filter((tab) => {
            const tabScope = scopeForTab(tab);
            return tabScope ? stageSessionScopeKey(tabScope) === scopeKey : false;
          });
          const converged = await reconcileStageSessionScope(
            { scope, tabs, visibleTabIds: visibleBrowserTabIds },
            commands,
            isCurrent,
          );
          if (cancelled) return;
          if (!converged) {
            failedScopes.set(scopeKey, scope);
            return;
          }
          if (!liveScopes.has(scopeKey)) knownScopesRef.current.delete(scopeKey);
        }),
      );
      if (cancelled || failedScopes.size === 0) return;
      const delay = stageSessionReconciliationRetryDelay(retryAttempt);
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        void reconcile(failedScopes);
      }, delay);
    };
    void reconcile(scopesToReconcile);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [activeStageTabId, stageOpenTabs, stagePrimaryTab, stageSplitTabId]);

  useEffect(
    () => () => {
      for (const scope of knownScopesRef.current.values()) {
        void invokeCommand('browser_session_list_scoped', { scope: nativeScope(scope) })
          .then((sessions) =>
            Promise.allSettled(
              sessions.map((session) =>
                enqueueNativeStageSessionMutation(
                  nativeStageSessionKey('browser', scope, session.sessionId),
                  async () => {
                    if (hasActiveNativeStageSessionLease('browser', scope, session.sessionId)) {
                      return;
                    }
                    await invokeCommand('browser_session_set_visible', {
                      sessionId: session.sessionId,
                      scope: nativeScope(scope),
                      visible: false,
                    });
                  },
                ),
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
