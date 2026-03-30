import { InMemoryEventBus } from '@offisim/core/browser';
import {
  CompanyProvider,
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeValue,
  isTauri,
} from '@offisim/ui-office';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeBundle } from '../lib/browser-runtime';
import { loadBrowserRuntimeBootstrapState } from '../lib/browser-runtime-storage';

interface BootstrapProviderProps {
  children: React.ReactNode;
}

export function BootstrapProvider({ children }: BootstrapProviderProps) {
  const [runtime, setRuntime] = useState<RuntimeBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const bootstrapStateRef = useRef(loadBrowserRuntimeBootstrapState());
  const eventBusRef = useRef(new InMemoryEventBus());

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
    let disposed = false;
    setRuntime(null);
    setError(null);

    void initRuntime()
      .then((nextRuntime) => {
        if (disposed) {
          nextRuntime.dispose?.();
          return;
        }
        setRuntime(nextRuntime);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
    };
  }, [initRuntime, version]);

  useEffect(() => {
    return () => {
      runtime?.dispose?.();
    };
  }, [runtime]);

  const value = useMemo<OffisimRuntimeValue>(
    () => ({
      eventBus: eventBusRef.current,
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
