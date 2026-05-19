import { InMemoryEventBus } from '@offisim/core/browser';
import {
  CompanyProvider,
  EMPTY_ENGINE_ADAPTERS,
  InMemorySceneIntentBus,
  OffisimRuntimeContext,
  OffisimRuntimeDesktopHostContext,
  type OffisimRuntimeDesktopHostValue,
  OffisimRuntimeExecutionContext,
  type OffisimRuntimeExecutionValue,
  OffisimRuntimeInteractionContext,
  type OffisimRuntimeInteractionValue,
  OffisimRuntimeServicesContext,
  type OffisimRuntimeServicesValue,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeValue,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeBundle } from '../lib/runtime-bundle';

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
  const eventBusRef = useRef(new InMemoryEventBus());
  const sceneIntentBusRef = useRef(new InMemorySceneIntentBus());

  const runtimeRef = useRef<RuntimeBundle | null>(null);

  const initRuntime = useCallback(async () => {
    const eventBus = eventBusRef.current;
    const { createTauriRuntimeReposOnly } = await import('../lib/tauri-runtime-lite');
    return createTauriRuntimeReposOnly(eventBus);
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

  const servicesValue = useMemo<OffisimRuntimeServicesValue>(
    () => ({
      eventBus: eventBusRef.current,
      sceneIntentBus: sceneIntentBusRef.current,
      installService: null,
      repos: runtime?.repos ?? null,
      employeeVersionService: null,
      toolTelemetryService: null,
      skillLoader: null,
      connectMcpServer: async () => 0,
      disconnectMcpServer: async () => {},
      connectedMcpServers: new Set(),
      listRecentDeliverables: undefined,
      loadDeliverableContent: undefined,
      availableEngineAdapters: EMPTY_ENGINE_ADAPTERS,
      companyEmployeeRuntimeDefault: null,
      attachmentStore: null,
    }),
    [runtime],
  );

  const executionValue = useMemo<OffisimRuntimeExecutionValue>(
    () => ({
      isReady: runtime?.repos != null,
      error,
      failedRunError: null,
      sendMessage: async () => undefined,
      retryLastMessage: async () => undefined,
      clearError: () => setError(null),
      reinitRuntime: () => {
        setVersion((prev) => prev + 1);
      },
      abortExecution: () => {},
      unfinishedThreads: [],
      dismissUnfinishedThreads: () => {},
      resumeThread: async () => {},
    }),
    [error, runtime],
  );

  const interactionValue = useMemo<OffisimRuntimeInteractionValue>(() => ({}), []);

  const desktopHostValue = useMemo<OffisimRuntimeDesktopHostValue>(
    () => ({ desktopVaultRoot: runtime?.desktopVaultRoot ?? null }),
    [runtime],
  );

  const value = useMemo<OffisimRuntimeValue>(
    () => ({
      ...servicesValue,
      ...executionValue,
      ...interactionValue,
      ...desktopHostValue,
      isRunning: false,
    }),
    [servicesValue, executionValue, interactionValue, desktopHostValue],
  );

  return (
    <OffisimRuntimeStatusContext.Provider value={{ isRunning: false, version }}>
      <OffisimRuntimeServicesContext.Provider value={servicesValue}>
        <OffisimRuntimeExecutionContext.Provider value={executionValue}>
          <OffisimRuntimeInteractionContext.Provider value={interactionValue}>
            <OffisimRuntimeDesktopHostContext.Provider value={desktopHostValue}>
              <OffisimRuntimeContext.Provider value={value}>
                <CompanyProvider repos={runtime?.repos ?? null} activeCompanyId={null}>
                  {children}
                </CompanyProvider>
              </OffisimRuntimeContext.Provider>
            </OffisimRuntimeDesktopHostContext.Provider>
          </OffisimRuntimeInteractionContext.Provider>
        </OffisimRuntimeExecutionContext.Provider>
      </OffisimRuntimeServicesContext.Provider>
    </OffisimRuntimeStatusContext.Provider>
  );
}
