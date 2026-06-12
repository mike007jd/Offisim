import { isDesktopProviderBridgeAvailable } from '@/lib/provider-bridge.js';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

/** A trusted DOM Escape this close to the native event means WKWebView
 * delivered the key itself (editable focus) — synthesizing would double-fire. */
const TRUSTED_DEDUPE_MS = 150;
/** One beat for the real DOM event to arrive before we synthesize. */
const SYNTHESIS_DELAY_MS = 50;

/**
 * wry (<= 0.55.1) swallows bare Escape before it reaches WKWebView content
 * (upstream wry PR 1711 unmerged). The Rust shell mirrors the key as an
 * `offisim-native-escape` event (escape_forwarder.rs); replay it as a DOM
 * keydown so every existing listener — Radix dismissable layers, cmdk,
 * wizard/settings window handlers — works unchanged. Skipped entirely in
 * the browser preview where Escape arrives natively.
 */
export function useNativeEscapeBridge() {
  useEffect(() => {
    if (!isDesktopProviderBridgeAvailable()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let pendingTimer: number | undefined;
    let lastTrustedEscapeAt = Number.NEGATIVE_INFINITY;

    const onTrustedKeydown = (event: KeyboardEvent) => {
      if (event.isTrusted && event.key === 'Escape') {
        lastTrustedEscapeAt = performance.now();
      }
    };
    window.addEventListener('keydown', onTrustedKeydown, true);

    void listen('offisim-native-escape', () => {
      // WebKit re-dispatches an unhandled keyDown through sendEvent a second
      // time, so the shell monitor mirrors one physical press twice
      // (live-verified 2026-06-12). Debounce: duplicates inside the
      // synthesis window collapse into a single DOM event.
      window.clearTimeout(pendingTimer);
      const receivedAt = performance.now();
      pendingTimer = window.setTimeout(() => {
        if (disposed) return;
        if (lastTrustedEscapeAt >= receivedAt - TRUSTED_DEDUPE_MS) return;
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
            cancelable: true,
          }),
        );
      }, SYNTHESIS_DELAY_MS);
    }).then((next) => {
      if (disposed) {
        next();
      } else {
        unlisten = next;
      }
    });

    return () => {
      disposed = true;
      window.clearTimeout(pendingTimer);
      window.removeEventListener('keydown', onTrustedKeydown, true);
      unlisten?.();
    };
  }, []);
}
