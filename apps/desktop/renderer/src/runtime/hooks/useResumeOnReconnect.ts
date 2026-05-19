import { isTauri } from '@offisim/ui-office/web';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { RuntimeBundle } from '../../lib/runtime-bundle';
import type { LastFailedMessage } from '../last-failed-message';

interface ResumeSnapshotEvent {
  status?: string;
  state?: unknown;
  lastCheckpointTs?: number | null;
}

function loadResumeSnapshotFromSse(threadId: string): Promise<ResumeSnapshotEvent | null> {
  if (isTauri() || typeof EventSource === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const source = new EventSource(`/api/conversations/${encodeURIComponent(threadId)}/resume`);
    const done = (snapshot: ResumeSnapshotEvent | null) => {
      source.close();
      resolve(snapshot);
    };
    const timer = window.setTimeout(() => done(null), 3000);
    source.addEventListener('resume.snapshot', (event) => {
      window.clearTimeout(timer);
      try {
        done(JSON.parse((event as MessageEvent).data) as ResumeSnapshotEvent);
      } catch {
        done(null);
      }
    });
    source.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
  });
}

async function loadResumeSnapshotFromTauri(threadId: string): Promise<ResumeSnapshotEvent | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = (await import('@tauri-apps/api/core')) as {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    return invoke<ResumeSnapshotEvent | null>('resume_conversation', { id: threadId });
  } catch (err) {
    console.warn('[resume-on-reconnect] tauri snapshot unavailable', err);
    return null;
  }
}

export function useResumeOnReconnect({
  runtimeRef,
  lastFailedMessageRef,
  setIsRunning,
  setError,
}: {
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  lastFailedMessageRef: MutableRefObject<LastFailedMessage | null>;
  setIsRunning: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}): void {
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const resume = async () => {
      const failed = lastFailedMessageRef.current;
      const runtime = runtimeRef.current;
      if (!failed || !runtime?.orch) return;
      const threadId = failed.threadId ?? runtime.runtimeCtx.threadId;
      if (!threadId) return;
      if (inFlightRef.current) return inFlightRef.current;

      inFlightRef.current = (async () => {
        setIsRunning(true);
        setError(null);
        try {
          const hostSnapshot = isTauri()
            ? await loadResumeSnapshotFromTauri(threadId)
            : await loadResumeSnapshotFromSse(threadId);
          const localSnapshot = await runtime.runtimeCtx.resumeCoordinator?.resume(threadId);
          if (!localSnapshot && hostSnapshot?.status === 'not-found') {
            throw new Error(`No checkpoint state found for thread "${threadId}".`);
          }
          await runtime.orch?.resumePlan(threadId, { skipCompletedSteps: true });
          lastFailedMessageRef.current = null;
        } catch (err) {
          console.error('[resume-on-reconnect] failed', err);
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsRunning(false);
          inFlightRef.current = null;
        }
      })();
      return inFlightRef.current;
    };

    const onOnline = () => void resume();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void resume();
      }
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runtimeRef, lastFailedMessageRef, setIsRunning, setError]);
}
