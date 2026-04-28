import {
  EmployeeVersionService,
  handleSkillInstallTool,
  runtimeBindingsEqual,
} from '@offisim/core/browser';
import type { NotificationBridge } from '@offisim/core/dist/services/notification-bridge.js';
import { ENGINE_IDS, type EmployeeRuntimeBinding, type EngineId } from '@offisim/shared-types';
import {
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeStatusValue,
  type OffisimRuntimeValue,
  type VaultDirectoryStatus,
  useChatStreamingSync,
} from '@offisim/ui-office/web';
import { useMemo, useRef } from 'react';
import { loadBrowserRuntimeSnapshot } from '../lib/browser-runtime-storage';
import { useInteractionSync } from './hooks/useInteractionSync';
import { useNotificationBridge } from './hooks/useNotificationBridge';
import { useResumeOnReconnect } from './hooks/useResumeOnReconnect';
import { useRuntimeInit } from './hooks/useRuntimeInit';
import { useSceneIntentWiring } from './hooks/useSceneIntentWiring';
import {
  type UnfinishedThread,
  useUnfinishedThreadDetection,
} from './hooks/useUnfinishedThreadDetection';
import { loadDefaultInteractionMode } from './interaction-mode-storage';
import { isRuntimeReadyForInteraction } from './runtime-readiness';
import { useRuntimeMeetingBridge } from './useRuntimeMeetingBridge';

export type { UnfinishedThread };

function deriveAvailableEngineAdapters(
  registry: { get(id: EngineId): unknown } | undefined,
): ReadonlySet<EngineId> {
  if (!registry) return new Set<EngineId>();
  const present: EngineId[] = [];
  for (const id of ENGINE_IDS) {
    if (registry.get(id)) present.push(id);
  }
  return new Set(present);
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

interface Props {
  companyId: string;
  children: React.ReactNode;
}

export function OffisimRuntimeProvider({ companyId, children }: Props) {
  const notificationBridgeRef = useRef<NotificationBridge | null>(null);
  const lastAdaptersRef = useRef<ReadonlySet<EngineId>>(new Set<EngineId>());
  const lastCompanyDefaultRef = useRef<EmployeeRuntimeBinding | null>(null);

  const {
    eventBus,
    runtime,
    runtimeRef,
    bootstrapStateRef,
    detectionDoneRef,
    lastFailedMessageRef,
    isInitializing,
    error,
    failedRunState,
    setError,
    clearError,
    version,
    reinit,
    isRunning,
    isRunningRef,
    setIsRunning,
    connectedMcpServers,
    connectMcpServer,
    disconnectMcpServer,
    abortExecution,
    sendMessage,
    retryLastMessage,
    listRecentDeliverables,
    loadDeliverableContent,
  } = useRuntimeInit({
    companyId,
    notificationBridgeRef,
    getDefaultInteractionMode: loadDefaultInteractionMode,
  });

  useChatStreamingSync(eventBus);

  const { sceneIntentBus } = useSceneIntentWiring({ eventBus });
  useNotificationBridge({ eventBus, companyId, bridgeRef: notificationBridgeRef });

  const { interactionMode, pendingInteraction, setInteractionMode, respondToInteraction } =
    useInteractionSync({
      eventBus,
      runtime,
      runtimeRef,
      sendMessage,
      retryLastMessage,
      lastFailedMessageRef,
      setError,
    });

  useRuntimeMeetingBridge({ eventBus, runtimeRef, setIsRunning, setError });
  useResumeOnReconnect({ runtimeRef, lastFailedMessageRef, setIsRunning, setError });

  const { unfinishedThreads, dismissUnfinishedThreads, resumeThread } =
    useUnfinishedThreadDetection({
      runtime,
      runtimeRef,
      detectionDoneRef,
      companyId,
      version,
      setIsRunning,
      setError,
    });

  // biome-ignore lint/correctness/useExhaustiveDependencies: version signals runtime readiness
  const employeeVersionService = useMemo(() => {
    if (!runtime?.repos) return null;
    return new EmployeeVersionService(
      runtime.repos.employeeVersions,
      runtime.repos.employees,
      eventBus,
      runtime.repos.transact,
    );
  }, [version, eventBus]);

  const statusValue = useMemo<OffisimRuntimeStatusValue>(
    () => ({ isRunning, version }),
    [isRunning, version],
  );

  const shouldExposeDebugBridge = import.meta.env.DEV;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces reinit; runtimeRef reads current
  const value = useMemo<OffisimRuntimeValue>(() => {
    if (shouldExposeDebugBridge) {
      const existingGetSceneState = window.__OFFISIM_DEBUG__?.getSceneState;
      window.__OFFISIM_DEBUG__ = {
        eventBus,
        sceneIntentBus,
        installService: runtime?.installService ?? null,
        repos: runtime?.repos ?? null,
        companyId,
        pendingInteraction: pendingInteraction ?? null,
        respondToInteraction,
        runSkillInstallTool: async (toolName: string, args: Record<string, unknown> = {}) => {
          const activeRuntime = runtimeRef.current;
          const runtimeCtx = activeRuntime?.runtimeCtx;
          if (!runtimeCtx) {
            throw new Error('Runtime context unavailable');
          }
          const raw = await handleSkillInstallTool(toolName as never, args, runtimeCtx, '');
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        },
        sendMessage,
        abortExecution,
        getSceneState:
          existingGetSceneState ??
          (() => {
            const snapshot = loadBrowserRuntimeSnapshot();
            const employees = (snapshot?.employees ?? []).filter((e) => e.company_id === companyId);
            return {
              employeeCount: employees.length,
              employeeIds: employees.map((e) => e.employee_id),
            };
          }),
      };
    }
    const nextAdapters = deriveAvailableEngineAdapters(runtime?.runtimeCtx?.engineAdapters);
    if (!setsEqual(lastAdaptersRef.current, nextAdapters)) {
      lastAdaptersRef.current = nextAdapters;
    }
    const rawCompanyDefault = runtime?.runtimeCtx?.runtimePolicy?.employeeRuntimeDefault ?? null;
    if (!runtimeBindingsEqual(lastCompanyDefaultRef.current, rawCompanyDefault)) {
      lastCompanyDefaultRef.current = rawCompanyDefault;
    }

    return {
      eventBus,
      sceneIntentBus,
      isReady: !isInitializing && isRuntimeReadyForInteraction(runtime),
      get isRunning() {
        return isRunningRef.current;
      },
      error,
      failedRunError: failedRunState
        ? {
            message: failedRunState.message,
            targetEmployeeId: failedRunState.targetEmployeeId,
            threadId: failedRunState.threadId,
            conversationKey: failedRunState.conversationKey,
          }
        : null,
      sendMessage,
      retryLastMessage,
      clearError,
      reinitRuntime: reinit,
      installService: runtime?.installService ?? null,
      repos: runtime?.repos ?? null,
      employeeVersionService,
      toolTelemetryService: runtime?.toolTelemetryService ?? null,
      skillLoader: runtime?.skillLoader ?? null,
      connectMcpServer,
      disconnectMcpServer,
      connectedMcpServers,
      abortExecution,
      unfinishedThreads,
      dismissUnfinishedThreads,
      resumeThread,
      bootstrapState: bootstrapStateRef.current,
      interactionMode,
      pendingInteraction,
      setInteractionMode,
      respondToInteraction,
      desktopVaultRoot: runtime?.desktopVaultRoot ?? null,
      getVaultDirectoryStatus: runtime?.browserVault
        ? () => runtime.browserVault?.getStatus() as Promise<VaultDirectoryStatus>
        : undefined,
      mountVaultDirectory: runtime?.browserVault
        ? (handle?: FileSystemDirectoryHandle) =>
            runtime.browserVault?.mount(handle) as Promise<VaultDirectoryStatus>
        : undefined,
      unmountVaultDirectory: runtime?.browserVault
        ? () => runtime.browserVault?.unmount() as Promise<VaultDirectoryStatus>
        : undefined,
      exportVaultSnapshotZip: undefined,
      listRecentDeliverables,
      loadDeliverableContent,
      availableEngineAdapters: lastAdaptersRef.current,
      companyEmployeeRuntimeDefault: lastCompanyDefaultRef.current,
    };
  }, [
    isInitializing,
    error,
    failedRunState,
    sendMessage,
    retryLastMessage,
    clearError,
    reinit,
    version,
    connectMcpServer,
    disconnectMcpServer,
    connectedMcpServers,
    abortExecution,
    unfinishedThreads,
    dismissUnfinishedThreads,
    resumeThread,
    interactionMode,
    pendingInteraction,
    setInteractionMode,
    respondToInteraction,
    listRecentDeliverables,
    loadDeliverableContent,
    employeeVersionService,
    eventBus,
    sceneIntentBus,
    companyId,
    shouldExposeDebugBridge,
    runtimeRef,
  ]);

  return (
    <OffisimRuntimeStatusContext.Provider value={statusValue}>
      <OffisimRuntimeContext.Provider value={value}>{children}</OffisimRuntimeContext.Provider>
    </OffisimRuntimeStatusContext.Provider>
  );
}
