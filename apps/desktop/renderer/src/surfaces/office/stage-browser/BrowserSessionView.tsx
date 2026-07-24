import type { StageViewTarget } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  type BrowserSessionBounds,
  type BrowserSessionSnapshot,
  type NativeStageSessionScope,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import { BROWSER_SESSION_EVENT } from '@/surfaces/office/stage-browser/use-agent-browser-sessions.js';
import {
  type NativeStageSessionLease,
  acquireNativeStageSessionLease,
} from '@/surfaces/office/stage-viewer/StageSessionReconciler.js';
import { type UnlistenFn, listen } from '@tauri-apps/api/event';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './browser-session.css';
import { newestBrowserSnapshot } from './browser-session-state.js';
import {
  NATIVE_SURFACE_OVERLAY_SELECTOR,
  type NativeSurfaceRect,
  anyOverlayIntersectsHost,
  computeVisibleNativeBounds,
  sameNativeBounds,
} from './native-bounds.js';

type BrowserTarget = Extract<StageViewTarget, { kind: 'browser-session' }>;

// Mirrors agent_bounds() in apps/desktop/src-tauri/src/browser_agent_tools.rs:
// agent browser WebViews park outside the window's drawable area. A closing
// spectator must restore this parking spot — set_visible(false) alone leaves
// the view positioned on-screen, and the hidden-screenshot fallback would
// then flash the page at the spectator's rect.
const AGENT_BROWSER_OFFSCREEN_BOUNDS: BrowserSessionBounds = {
  x: 16_384,
  y: 16_384,
  width: 1_280,
  height: 720,
};

function nativeScope(target: BrowserTarget): NativeStageSessionScope {
  return target.scope;
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// addresses can open in Browser.');
  }
  return url.toString();
}

function collectOverlayRects(): NativeSurfaceRect[] {
  return Array.from(document.querySelectorAll(NATIVE_SURFACE_OVERLAY_SELECTOR)).map((element) =>
    element.getBoundingClientRect(),
  );
}

export function BrowserSessionView({ target }: { target: BrowserTarget }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const sessionLeaseRef = useRef<NativeStageSessionLease | null>(null);
  const [snapshot, setSnapshot] = useState<BrowserSessionSnapshot | null>(null);
  const [address, setAddress] = useState(target.initialUrl);
  const [error, setError] = useState<string | null>(null);
  const visibleUrl = snapshot?.url || address || target.initialUrl;
  const isSecurePage = visibleUrl.startsWith('https://');
  const spectatorMode = Boolean(target.agent) || snapshot?.agent === true;
  const employeeName = target.agent?.employeeName ?? 'Employee';

  useEffect(() => {
    if (!snapshot?.url || document.activeElement === addressRef.current) return;
    setAddress(snapshot.url);
  }, [snapshot?.url]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scope = nativeScope(target);
    const lease = acquireNativeStageSessionLease('browser', target.scope, target.sessionId);
    sessionLeaseRef.current = lease;
    let unlisten: UnlistenFn | undefined;
    let poll = 0;
    let syncFrame = 0;
    let created = false;
    let syncInFlight = false;
    let syncQueued = false;
    let lastSentBounds: BrowserSessionBounds | null = null;
    let lastVisible: boolean | null = null;

    const acceptSnapshot = (next: BrowserSessionSnapshot) => {
      if (next.sessionId !== target.sessionId || !lease.isCurrent()) return;
      setSnapshot((current) => newestBrowserSnapshot(current, next));
      if (next.status !== 'error') setError(null);
      else if (next.error) setError(next.error);
    };

    // The native child WebView always paints above the main WebView, so the
    // only correct tools are its bounds and its visibility: track the host's
    // visible rect (host ∩ app viewport, logical coordinates), hide on zero
    // area or when an application overlay intersects the host, and resync on
    // restore. The host element is the dedicated grid track below the
    // Browser-owned chrome, so its rect already excludes the chrome — no
    // chrome measurement or pixel inset. Updates are RAF-coalesced and only
    // sent when the rounded logical bounds actually change by at least 1px.
    const syncOnce = async () => {
      if (!lease.isCurrent() || !host.isConnected) return;
      const rect = host.getBoundingClientRect();
      const bounds = computeVisibleNativeBounds(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const visible = bounds !== null && !anyOverlayIntersectsHost(rect, collectOverlayRects());
      if (!created) {
        // A child WebView is visible as soon as Tauri creates or reattaches it.
        // Do not create while its host is clipped or covered, otherwise it can
        // flash above the very overlay that is meant to hide it.
        if (!bounds || !visible) return;
        created = true;
        try {
          const initial = target.agent
            ? await lease.runIfCurrent(async () => {
                const attached = await invokeCommand('browser_session_snapshot', {
                  sessionId: target.sessionId,
                  scope,
                });
                await invokeCommand('browser_session_set_bounds', {
                  sessionId: target.sessionId,
                  scope,
                  bounds,
                });
                await invokeCommand('browser_session_set_visible', {
                  sessionId: target.sessionId,
                  scope,
                  visible: true,
                });
                return attached;
              })
            : await lease.runIfCurrent(() =>
                invokeCommand('browser_session_create', {
                  sessionId: target.sessionId,
                  scope,
                  url: normalizeAddress(target.initialUrl),
                  bounds,
                }),
              );
          if (!lease.isCurrent()) return;
          if (initial) acceptSnapshot(initial);
          lastSentBounds = bounds;
          lastVisible = true;
          if (poll === 0) {
            poll = window.setInterval(() => {
              if (!lease.isCurrent()) return;
              // Geometry resync rides the snapshot poll so a missed observer,
              // a transiently failed bounds update, or a window/display
              // transition converges back to the host rect instead of leaving
              // the native child stuck over the chrome or short of the dock.
              scheduleSync();
              void invokeCommand('browser_session_snapshot', {
                sessionId: target.sessionId,
                scope,
              })
                .then(acceptSnapshot)
                .catch(() => {});
            }, 750);
          }
        } catch (cause) {
          created = false;
          if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
          return;
        }
      } else if (bounds && !sameNativeBounds(bounds, lastSentBounds)) {
        const sent = await lease
          .runIfCurrent(() =>
            invokeCommand('browser_session_set_bounds', {
              sessionId: target.sessionId,
              scope,
              bounds,
            }),
          )
          .then(() => true)
          .catch(() => false);
        if (!lease.isCurrent()) return;
        if (sent) lastSentBounds = bounds;
        else if (visible) return;
      }
      if (visible !== lastVisible) {
        const sent = await lease
          .runIfCurrent(() =>
            invokeCommand('browser_session_set_visible', {
              sessionId: target.sessionId,
              scope,
              visible,
            }),
          )
          .then(() => true)
          .catch(() => false);
        if (sent) lastVisible = visible;
      }
    };

    const syncNativeSurface = () => {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      void (async () => {
        try {
          do {
            syncQueued = false;
            await syncOnce();
          } while (syncQueued && lease.isCurrent());
        } finally {
          syncInFlight = false;
        }
      })();
    };

    const scheduleSync = () => {
      window.cancelAnimationFrame(syncFrame);
      syncFrame = window.requestAnimationFrame(syncNativeSurface);
    };
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(host);
    // Portal overlays mount as direct children of <body>; watching only that
    // level catches overlay open/close without deep-subtree noise.
    const overlayObserver = new MutationObserver(scheduleSync);
    overlayObserver.observe(document.body, { childList: true });
    window.addEventListener('resize', scheduleSync);
    // The child WebView is positioned in native window coordinates. A scroll
    // can move the DOM host without resizing it, so capture scrolls from every
    // ancestor and the visual viewport instead of leaving the native surface
    // behind at its previous coordinates.
    document.addEventListener('scroll', scheduleSync, true);
    window.visualViewport?.addEventListener('scroll', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);

    void (async () => {
      try {
        const nextUnlisten = await listen<BrowserSessionSnapshot>(
          BROWSER_SESSION_EVENT,
          ({ payload }) => {
            acceptSnapshot(payload);
          },
        );
        if (!lease.isCurrent()) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
        scheduleSync();
      } catch (cause) {
        if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      window.cancelAnimationFrame(syncFrame);
      window.clearInterval(poll);
      observer.disconnect();
      overlayObserver.disconnect();
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('scroll', scheduleSync, true);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      unlisten?.();
      if (sessionLeaseRef.current === lease) sessionLeaseRef.current = null;
      lease.release();
      void lease
        .runIfLatest(async () => {
          // Agent sessions outlive the spectator: re-park the native WebView
          // off-screen before hiding so the off-screen invariant is restored
          // rather than relying on visibility alone.
          if (target.agent) {
            await invokeCommand('browser_session_set_bounds', {
              sessionId: target.sessionId,
              scope,
              bounds: AGENT_BROWSER_OFFSCREEN_BOUNDS,
            });
          }
          await invokeCommand('browser_session_set_visible', {
            sessionId: target.sessionId,
            scope,
            visible: false,
          });
        })
        .catch(() => {});
    };
  }, [target]);

  useEffect(() => {
    const focusLocation = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'l') return;
      if (spectatorMode) return;
      event.preventDefault();
      addressRef.current?.focus();
      addressRef.current?.select();
    };
    document.addEventListener('keydown', focusLocation);
    return () => document.removeEventListener('keydown', focusLocation);
  }, [spectatorMode]);

  const navigate = async () => {
    if (spectatorMode) return;
    const lease = sessionLeaseRef.current;
    if (!lease?.isCurrent()) return;
    try {
      const url = normalizeAddress(address);
      setError(null);
      const next = await lease.runIfCurrent(() =>
        invokeCommand('browser_session_navigate', {
          sessionId: target.sessionId,
          scope: nativeScope(target),
          url,
        }),
      );
      if (!lease.isCurrent() || !next) return;
      setSnapshot((current) => newestBrowserSnapshot(current, next));
    } catch (cause) {
      if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const control = async (
    command: 'browser_session_back' | 'browser_session_forward' | 'browser_session_reload',
  ) => {
    if (spectatorMode) return;
    const lease = sessionLeaseRef.current;
    if (!lease?.isCurrent()) return;
    try {
      setError(null);
      const next = await lease.runIfCurrent(() =>
        invokeCommand(command, {
          sessionId: target.sessionId,
          scope: nativeScope(target),
        }),
      );
      if (!lease.isCurrent() || !next) return;
      setSnapshot((current) => newestBrowserSnapshot(current, next));
    } catch (cause) {
      if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const loading = snapshot?.status === 'creating' || snapshot?.status === 'loading';
  return (
    <section
      className="off-browser-session"
      aria-label={
        spectatorMode ? `${employeeName}'s browser, read-only spectator` : 'Built-in Browser'
      }
    >
      <div className="off-browser-chrome">
        <div className="off-browser-toolbar">
          <div className="off-browser-nav" aria-label="Browser navigation">
            <button
              type="button"
              className="off-focusable"
              onClick={() => void control('browser_session_back')}
              disabled={spectatorMode || !snapshot?.canGoBack}
              aria-label="Back"
              title={spectatorMode ? 'Read-only while the employee is browsing' : 'Back'}
            >
              <Icon icon={ArrowLeft} size="sm" />
            </button>
            <button
              type="button"
              className="off-focusable"
              onClick={() => void control('browser_session_forward')}
              disabled={spectatorMode || !snapshot?.canGoForward}
              aria-label="Forward"
              title={spectatorMode ? 'Read-only while the employee is browsing' : 'Forward'}
            >
              <Icon icon={ArrowRight} size="sm" />
            </button>
            <button
              type="button"
              className={cn('off-focusable', loading && 'is-loading')}
              onClick={() => void control('browser_session_reload')}
              disabled={spectatorMode}
              aria-label="Reload"
              title={spectatorMode ? 'Read-only while the employee is browsing' : 'Reload'}
            >
              <Icon icon={RefreshCw} size="sm" />
            </button>
          </div>
          <form
            className="off-browser-address"
            data-secure={isSecurePage ? 'true' : 'false'}
            data-readonly={spectatorMode ? 'true' : 'false'}
            title={spectatorMode ? 'Read-only while the employee is browsing' : undefined}
            onSubmit={(event) => {
              event.preventDefault();
              if (spectatorMode) return;
              addressRef.current?.blur();
              void navigate();
            }}
          >
            <Icon icon={isSecurePage ? LockKeyhole : Globe2} size="sm" />
            <input
              ref={addressRef}
              value={address}
              readOnly={spectatorMode}
              aria-readonly={spectatorMode}
              onChange={(event) => setAddress(event.currentTarget.value)}
              onBlur={() => {
                if (snapshot?.url) setAddress(snapshot.url);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                setAddress(snapshot?.url || target.initialUrl);
                event.currentTarget.blur();
              }}
              aria-label="Browser address"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </form>
          <div className="off-browser-badges">
            {spectatorMode ? (
              <span
                className="off-browser-employee"
                title="Employee is browsing. Navigation is locked to avoid competing for control."
              >
                <Icon icon={Eye} size="sm" />
                {employeeName} is browsing
              </span>
            ) : null}
            <span
              className="off-browser-isolation"
              title="This page has no Offisim local permissions"
            >
              <Icon icon={ShieldCheck} size="sm" />
              No local access
            </span>
          </div>
        </div>
        {loading || error ? (
          <output className={cn('off-browser-status', error && 'is-error')} aria-live="polite">
            {loading && !error ? <span>Loading page…</span> : null}
            {error ? <span>{error}</span> : null}
            {loading ? <div className="off-browser-progress" /> : null}
          </output>
        ) : null}
      </div>
      <div ref={hostRef} className="off-browser-native-host" aria-hidden="true" />
    </section>
  );
}
