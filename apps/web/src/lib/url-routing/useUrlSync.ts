import { useEffect, useRef, useState } from 'react';
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
  // popstateRev increments only on real `popstate` events (Back/Forward,
  // deep link). We deliberately do NOT use `useSyncExternalStore` over
  // `window.location` here — that approach also fires whenever React detects
  // snapshot drift from our own `pushState`, which manifested as #10 / #12:
  // a click after a successful URL push would re-fire the input-side effect
  // with the previous URL, calling `applyParsed` and reverting the workspace
  // we just navigated to.
  const [popstateRev, setPopstateRev] = useState(0);

  const isApplyingPopstateRef = useRef(false);
  const applyParsedRef = useRef(applyParsed);
  const runtimeRef = useRef(runtime);
  const activeCompanyIdRef = useRef(activeCompanyId);
  const emitToastRef = useRef(emitToast);
  const onPopStateRef = useRef(onPopState);
  const sessionStateRef = useRef(sessionState);

  useEffect(() => {
    applyParsedRef.current = applyParsed;
    runtimeRef.current = runtime;
    activeCompanyIdRef.current = activeCompanyId;
    emitToastRef.current = emitToast;
    onPopStateRef.current = onPopState;
    sessionStateRef.current = sessionState;
  }, [activeCompanyId, applyParsed, emitToast, onPopState, runtime, sessionState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setPopstateRev((n) => n + 1);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // Popstate path: external URL changes (Back/Forward, deep link). Apply
  // fallback for the new URL and let `applyParsed` reconcile state.
  useEffect(() => {
    if (popstateRev === 0) return; // initial mount — initial state was set by parseInitialUrl
    onPopStateRef.current?.();
    if (!enabled) return;

    isApplyingPopstateRef.current = true;
    const parsed = parseUrl(window.location);
    const fallback = applyFallbackRules(parsed, {
      activeCompanyId: activeCompanyIdRef.current,
      ...runtimeRef.current,
    });
    applyParsedRef.current(fallback.result);
    if (fallback.toast) emitToastRef.current?.(fallback.toast);

    queueMicrotask(() => {
      isApplyingPopstateRef.current = false;
    });
  }, [enabled, popstateRev]);

  // Fallback re-check path: when input data (companies, agents, listings, sops)
  // arrives or activeCompanyId changes, recheck the *current URL* for stale
  // entities. Decoupled from output state (workspace / sessionState / overlay)
  // to prevent state-change-triggered reverts: if this ran on workspace change,
  // it would read the OLD URL, detect a stale entity there, and revert
  // `activeWorkspace` back to the old value before the new URL was pushed.
  useEffect(() => {
    if (!enabled || isApplyingPopstateRef.current) return;
    const currentParsed = parseUrl(window.location);
    const fallback = applyFallbackRules(currentParsed, {
      activeCompanyId,
      ...runtime,
    });
    if (parsedEquals(currentParsed, fallback.result)) return;

    isApplyingPopstateRef.current = true;
    applyParsedRef.current(fallback.result);
    if (fallback.toast) emitToastRef.current?.(fallback.toast);
    const fallbackSessionState = mergeSessionPatch(
      sessionStateRef.current,
      fallback.result.sessionPatch,
    );
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
  }, [activeCompanyId, enabled, runtime]);

  // Serialize path: when output state (workspace / sessionState / overlay)
  // changes, push the new URL. Does not run fallback — fallback only ever runs
  // on URL coming IN (popstate or new input data), never on URL going OUT.
  useEffect(() => {
    if (!enabled || isApplyingPopstateRef.current) return;
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
  }, [activeCompanyId, enabled, overlay, sessionState, workspace]);
}
