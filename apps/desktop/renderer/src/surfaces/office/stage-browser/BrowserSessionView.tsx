import type { StageViewTarget } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  type BrowserSessionBounds,
  type BrowserSessionSnapshot,
  type NativeStageSessionScope,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import {
  type NativeStageSessionLease,
  acquireNativeStageSessionLease,
} from '@/surfaces/office/stage-viewer/StageSessionReconciler.js';
import { useSetStageChrome } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import { type UnlistenFn, listen } from '@tauri-apps/api/event';
import { ArrowLeft, ArrowRight, Globe2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './browser-session.css';
import { newestBrowserSnapshot } from './browser-session-state.js';

type BrowserTarget = Extract<StageViewTarget, { kind: 'browser-session' }>;

const BROWSER_EVENT = 'offisim-browser-session-event-v1';

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

function boundsFor(element: HTMLElement): BrowserSessionBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(120, Math.round(rect.width)),
    height: Math.max(80, Math.round(rect.height)),
  };
}

export function BrowserSessionView({ target }: { target: BrowserTarget }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const sessionLeaseRef = useRef<NativeStageSessionLease | null>(null);
  const [snapshot, setSnapshot] = useState<BrowserSessionSnapshot | null>(null);
  const [address, setAddress] = useState(target.initialUrl);
  const [error, setError] = useState<string | null>(null);
  const setChrome = useSetStageChrome();
  const visibleUrl = snapshot?.url || address || target.initialUrl;
  const isSecurePage = visibleUrl.startsWith('https://');

  useEffect(() => {
    setChrome({
      title: snapshot?.title || target.title || 'Browser',
      meta: snapshot?.url || target.initialUrl,
      badge: 'You · Manual',
    });
    return () => setChrome(null);
  }, [setChrome, snapshot?.title, snapshot?.url, target.initialUrl, target.title]);

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
    let resizeFrame = 0;

    const acceptSnapshot = (next: BrowserSessionSnapshot) => {
      if (next.sessionId !== target.sessionId || !lease.isCurrent()) return;
      setSnapshot((current) => newestBrowserSnapshot(current, next));
      if (next.status !== 'error') setError(null);
      else if (next.error) setError(next.error);
    };

    const syncBounds = () => {
      if (!lease.isCurrent() || !host.isConnected) return;
      void lease
        .runIfCurrent(() =>
          invokeCommand('browser_session_set_bounds', {
            sessionId: target.sessionId,
            scope,
            bounds: boundsFor(host),
          }),
        )
        .catch(() => {});
    };

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(syncBounds);
    });
    observer.observe(host);

    void (async () => {
      try {
        const nextUnlisten = await listen<BrowserSessionSnapshot>(BROWSER_EVENT, ({ payload }) => {
          acceptSnapshot(payload);
        });
        if (!lease.isCurrent()) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
        const initial = await lease.runIfCurrent(() =>
          invokeCommand('browser_session_create', {
            sessionId: target.sessionId,
            scope,
            url: normalizeAddress(target.initialUrl),
            bounds: boundsFor(host),
          }),
        );
        if (!lease.isCurrent() || !initial) return;
        acceptSnapshot(initial);
        await lease.runIfCurrent(() =>
          invokeCommand('browser_session_set_visible', {
            sessionId: target.sessionId,
            scope,
            visible: true,
          }),
        );
        if (!lease.isCurrent()) return;
        syncBounds();
        if (!lease.isCurrent()) return;
        poll = window.setInterval(() => {
          if (!lease.isCurrent()) return;
          void invokeCommand('browser_session_snapshot', {
            sessionId: target.sessionId,
            scope,
          })
            .then(acceptSnapshot)
            .catch(() => {});
        }, 750);
      } catch (cause) {
        if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.clearInterval(poll);
      observer.disconnect();
      unlisten?.();
      if (sessionLeaseRef.current === lease) sessionLeaseRef.current = null;
      lease.release();
      void lease
        .runIfLatest(() =>
          invokeCommand('browser_session_set_visible', {
            sessionId: target.sessionId,
            scope,
            visible: false,
          }),
        )
        .catch(() => {});
    };
  }, [target]);

  const navigate = async () => {
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
    <section className="off-browser-session" aria-label="Built-in Browser">
      <div className="off-browser-chrome">
        <div className="off-browser-toolbar">
          <div className="off-browser-nav" aria-label="Browser navigation">
            <button
              type="button"
              className="off-focusable"
              onClick={() => void control('browser_session_back')}
              disabled={!snapshot?.canGoBack}
              aria-label="Back"
              title="Back"
            >
              <Icon icon={ArrowLeft} size="sm" />
            </button>
            <button
              type="button"
              className="off-focusable"
              onClick={() => void control('browser_session_forward')}
              disabled={!snapshot?.canGoForward}
              aria-label="Forward"
              title="Forward"
            >
              <Icon icon={ArrowRight} size="sm" />
            </button>
            <button
              type="button"
              className={cn('off-focusable', loading && 'is-loading')}
              onClick={() => void control('browser_session_reload')}
              aria-label="Reload"
              title="Reload"
            >
              <Icon icon={RefreshCw} size="sm" />
            </button>
          </div>
          <form
            className="off-browser-address"
            data-secure={isSecurePage ? 'true' : 'false'}
            onSubmit={(event) => {
              event.preventDefault();
              addressRef.current?.blur();
              void navigate();
            }}
          >
            <Icon icon={isSecurePage ? LockKeyhole : Globe2} size="sm" />
            <input
              ref={addressRef}
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              onBlur={() => {
                if (snapshot?.url) setAddress(snapshot.url);
              }}
              aria-label="Browser address"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </form>
          <span
            className="off-browser-isolation"
            title="This page has no Offisim local permissions"
          >
            <Icon icon={ShieldCheck} size="sm" />
            No local access
          </span>
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
