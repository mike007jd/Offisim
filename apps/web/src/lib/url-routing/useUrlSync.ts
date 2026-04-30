import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { WorkspaceKey, WorkspaceSessionState } from '../../components/workspaces/types';
import { applyFallbackRules } from './fallback';
import { mergeSessionPatch } from './merge';
import { parseUrl } from './parser';
import { serializeUrl, shouldReplaceUrl } from './serializer';
import type { ParsedUrl, UrlFallbackRuntime, UrlFallbackToast, UrlOverlayKey } from './types';

function parsedEquals(a: ParsedUrl, b: ParsedUrl): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function locationSnapshot(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

function subscribeLocation(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

function parsedUrlFromString(url: string): ParsedUrl {
  const parsed = new URL(url, window.location.origin);
  return parseUrl(parsed);
}

export interface UseUrlSyncInput {
  workspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  overlay: UrlOverlayKey | null;
  activeCompanyId: string | null;
  applyParsed: (parsed: ParsedUrl) => void;
  runtime?: Omit<UrlFallbackRuntime, 'activeCompanyId'>;
  emitToast?: (toast: UrlFallbackToast) => void;
  onPopState?: () => void;
  enabled?: boolean;
}

export function useUrlSync({
  workspace,
  sessionState,
  overlay,
  activeCompanyId,
  applyParsed,
  runtime,
  emitToast,
  onPopState,
  enabled = true,
}: UseUrlSyncInput): void {
  const snapshot = useSyncExternalStore(subscribeLocation, locationSnapshot, () => '/');
  const didObserveSnapshotRef = useRef(false);
  const isApplyingPopstateRef = useRef(false);
  const applyParsedRef = useRef(applyParsed);
  const runtimeRef = useRef(runtime);
  const activeCompanyIdRef = useRef(activeCompanyId);
  const emitToastRef = useRef(emitToast);
  const onPopStateRef = useRef(onPopState);

  useEffect(() => {
    applyParsedRef.current = applyParsed;
    runtimeRef.current = runtime;
    activeCompanyIdRef.current = activeCompanyId;
    emitToastRef.current = emitToast;
    onPopStateRef.current = onPopState;
  }, [activeCompanyId, applyParsed, emitToast, onPopState, runtime]);

  useEffect(() => {
    if (!didObserveSnapshotRef.current) {
      didObserveSnapshotRef.current = true;
      return;
    }

    onPopStateRef.current?.();
    if (!enabled) return;

    isApplyingPopstateRef.current = true;
    const parsed = parsedUrlFromString(snapshot);
    const fallback = applyFallbackRules(parsed, {
      activeCompanyId: activeCompanyIdRef.current,
      ...runtimeRef.current,
    });
    applyParsedRef.current(fallback.result);
    if (fallback.toast) emitToastRef.current?.(fallback.toast);

    queueMicrotask(() => {
      isApplyingPopstateRef.current = false;
    });
  }, [enabled, snapshot]);

  useEffect(() => {
    if (!enabled || isApplyingPopstateRef.current) return;
    const currentParsed = parseUrl(window.location);
    const fallback = applyFallbackRules(currentParsed, {
      activeCompanyId,
      ...runtime,
    });
    if (!parsedEquals(currentParsed, fallback.result)) {
      isApplyingPopstateRef.current = true;
      applyParsedRef.current(fallback.result);
      if (fallback.toast) emitToastRef.current?.(fallback.toast);
      const fallbackSessionState = mergeSessionPatch(sessionState, fallback.result.sessionPatch);
      const fallbackUrl = serializeUrl({
        workspace: fallback.result.workspace,
        sessionState: fallbackSessionState,
        overlay: fallback.result.overlay,
        activeCompanyId,
      });
      window.history.replaceState(null, '', fallbackUrl);
      queueMicrotask(() => {
        isApplyingPopstateRef.current = false;
      });
      return;
    }

    const nextUrl = serializeUrl({
      workspace,
      sessionState,
      overlay,
      activeCompanyId,
    });
    const currentUrl = locationSnapshot();
    if (currentUrl === nextUrl) return;

    const method = shouldReplaceUrl(parseUrl(window.location), parsedUrlFromString(nextUrl))
      ? 'replaceState'
      : 'pushState';
    window.history[method](null, '', nextUrl);
  }, [activeCompanyId, enabled, overlay, runtime, sessionState, workspace]);
}
