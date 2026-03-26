/**
 * useDeepLinkInstall — listens for `offisim://install` deep link events
 * from the Tauri shell and invokes a callback with the parsed payload.
 *
 * This hook is a no-op when running in a plain browser (non-Tauri) context.
 *
 * Usage:
 * ```tsx
 * useDeepLinkInstall(({ listingId, version }) => {
 *   // Fetch package from registry and trigger install review flow
 * });
 * ```
 */

import { useEffect, useRef } from 'react';
import { isTauri } from '../lib/env.js';

export interface DeepLinkInstallPayload {
  listing_id: string;
  version: string;
}

type DeepLinkHandler = (payload: DeepLinkInstallPayload) => void;

/**
 * Listen for deep link install events from the Tauri shell.
 *
 * @param onInstallRequest — called when the desktop app receives an
 *   `offisim://install?listing_id=X&version=Y` deep link. The handler
 *   receives the parsed listing_id and version.
 */
export function useDeepLinkInstall(onInstallRequest: DeepLinkHandler): void {
  // Keep a stable ref so the effect doesn't re-subscribe on every render
  const handlerRef = useRef<DeepLinkHandler>(onInstallRequest);
  handlerRef.current = onInstallRequest;

  useEffect(() => {
    if (!isTauri()) return;

    let mounted = true;
    const unlistenRef: { current: (() => void) | undefined } = { current: undefined };

    // Dynamically import Tauri event API (tree-shaken in browser builds)
    // Use string concat to prevent Vite's import-analysis from statically rejecting this
    const tauriEventModule = '@tauri-apps' + '/api/event';
    import(/* @vite-ignore */ tauriEventModule)
      .then(({ listen }) => {
        return (
          listen as (
            evt: string,
            handler: (event: { payload: DeepLinkInstallPayload }) => void,
          ) => Promise<() => void>
        )('deep-link-install', (event: { payload: DeepLinkInstallPayload }) => {
          const payload = event.payload;
          if (payload?.listing_id && payload?.version) {
            handlerRef.current(payload);
          } else {
            console.warn('[useDeepLinkInstall] Received malformed payload:', payload);
          }
        });
      })
      .then((unlistenFn) => {
        if (!mounted) {
          // Component unmounted before the Promise resolved — clean up immediately
          unlistenFn();
        } else {
          unlistenRef.current = unlistenFn;
        }
      })
      .catch((err) => {
        console.error('[useDeepLinkInstall] Failed to register listener:', err);
      });

    return () => {
      mounted = false;
      unlistenRef.current?.();
    };
  }, []); // Empty deps — subscribe once, handler ref keeps it fresh
}
