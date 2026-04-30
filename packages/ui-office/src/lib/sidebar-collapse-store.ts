import { useCallback, useSyncExternalStore } from 'react';

export type SidebarCollapseValue = 'expanded' | 'collapsed';
export type SidebarWorkspaceKey =
  | 'office'
  | 'sops'
  | 'market'
  | 'personnel'
  | 'activity-log'
  | 'settings';

const listeners = new Set<() => void>();

function storageKey(workspaceKey: SidebarWorkspaceKey): string {
  return `offisim:workspace:${workspaceKey}:left-rail`;
}

function read(workspaceKey: SidebarWorkspaceKey): SidebarCollapseValue {
  if (typeof localStorage === 'undefined') return 'expanded';
  return localStorage.getItem(storageKey(workspaceKey)) === 'collapsed' ? 'collapsed' : 'expanded';
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getSidebarCollapse(workspaceKey: SidebarWorkspaceKey): SidebarCollapseValue {
  return read(workspaceKey);
}

export function setSidebarCollapse(
  workspaceKey: SidebarWorkspaceKey,
  value: SidebarCollapseValue,
): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(storageKey(workspaceKey), value);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === 'undefined') {
    return () => {
      listeners.delete(listener);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('offisim:workspace:')) notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSidebarCollapse(
  workspaceKey: SidebarWorkspaceKey,
): [SidebarCollapseValue, (value: SidebarCollapseValue) => void] {
  const value: SidebarCollapseValue = useSyncExternalStore(
    subscribe,
    () => read(workspaceKey),
    () => 'expanded' as SidebarCollapseValue,
  );
  const setValue = useCallback(
    (next: SidebarCollapseValue) => setSidebarCollapse(workspaceKey, next),
    [workspaceKey],
  );
  return [value, setValue];
}
