import { InMemoryEventBus } from '@offisim/core/browser';
import {
  CompanyProvider,
  InMemorySceneIntentBus,
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeValue,
  isTauri,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeBundle } from '../lib/browser-runtime';
import { loadBrowserRuntimeBootstrapState } from '../lib/browser-runtime-storage';

interface BootstrapProviderProps {
  children: React.ReactNode;
}

type BootstrapPhase = 'idle' | 'initializing' | 'ready' | 'failed';

type BootstrapDebugState = {
  phase: BootstrapPhase;
  error: string | null;
  runtimeReady: boolean;
};

function clearBootstrapTimeout(timeoutId: number | null): void {
  if (timeoutId !== null) {
    window.clearTimeout(timeoutId);
  }
}

export function BootstrapProvider({ children }: BootstrapProviderProps) {
  const [runtime, setRuntime] = useState<RuntimeBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<BootstrapPhase>('idle');
  const [version, setVersion] = useState(0);
  const bootstrapStateRef = useRef(loadBrowserRuntimeBootstrapState());
  const eventBusRef = useRef(new InMemoryEventBus());
  const sceneIntentBusRef = useRef(new InMemorySceneIntentBus());

  const runtimeRef = useRef<RuntimeBundle | null>(null);

  const initRuntime = useCallback(async () => {
    const eventBus = eventBusRef.current;
    if (isTauri()) {
      const { createTauriRuntimeReposOnly } = await import('../lib/tauri-runtime-lite');
      return createTauriRuntimeReposOnly(eventBus);
    }
    const { createBrowserRuntimeReposOnly } = await import('../lib/browser-runtime');
    return createBrowserRuntimeReposOnly(eventBus);
  }, []);

  useEffect(() => {
    void version;
    let disposed = false;
    setRuntime(null);
    setError(null);
    setPhase('initializing');

    const timeoutMs = 8000;
    let timeoutId: number | null = null;
    const timeout = new Promise<RuntimeBundle>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(
          new Error(
            `Bootstrap runtime timed out after ${timeoutMs / 1000}s while opening desktop data.`,
          ),
        );
      }, timeoutMs);
    });

    void Promise.race([initRuntime(), timeout])
      .then((nextRuntime) => {
        clearBootstrapTimeout(timeoutId);
        if (disposed) {
          nextRuntime.dispose?.();
          return;
        }
        runtimeRef.current = nextRuntime;
        setRuntime(nextRuntime);
        setPhase('ready');
      })
      .catch((err) => {
        clearBootstrapTimeout(timeoutId);
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Bootstrap] runtime init failed:', err);
        setError(message);
        setPhase('failed');
      });

    return () => {
      disposed = true;
      clearBootstrapTimeout(timeoutId);
      runtimeRef.current?.dispose?.();
      runtimeRef.current = null;
    };
  }, [initRuntime, version]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (
      window as typeof window & {
        __OFFISIM_BOOTSTRAP__?: BootstrapDebugState;
      }
    ).__OFFISIM_BOOTSTRAP__ = {
      phase,
      error,
      runtimeReady: runtime?.repos != null,
    };
  }, [error, phase, runtime]);

  const value = useMemo<OffisimRuntimeValue>(
    () => ({
      eventBus: eventBusRef.current,
      sceneIntentBus: sceneIntentBusRef.current,
      isReady: runtime?.repos != null,
      isRunning: false,
      error,
      sendMessage: async () => undefined,
      retryLastMessage: async () => undefined,
      clearError: () => setError(null),
      reinitRuntime: () => {
        bootstrapStateRef.current = loadBrowserRuntimeBootstrapState();
        setVersion((prev) => prev + 1);
      },
      installService: null,
      repos: runtime?.repos ?? null,
      employeeVersionService: null,
      toolTelemetryService: null,
      connectMcpServer: async () => 0,
      disconnectMcpServer: async () => {},
      connectedMcpServers: new Set(),
      abortExecution: () => {},
      unfinishedThreads: [],
      dismissUnfinishedThreads: () => {},
      resumeThread: async () => {},
      bootstrapState: bootstrapStateRef.current,
    }),
    [error, runtime],
  );

  return (
    <OffisimRuntimeContext.Provider value={value}>
      <OffisimRuntimeStatusContext.Provider value={{ isRunning: false, version }}>
        <CompanyProvider repos={runtime?.repos ?? null} activeCompanyId={null}>
          {children}
        </CompanyProvider>
      </OffisimRuntimeStatusContext.Provider>
    </OffisimRuntimeContext.Provider>
  );
}
