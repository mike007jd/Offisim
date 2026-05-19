import {
  EmployeeVersionService,
  handleSkillInstallTool,
  runtimeBindingsEqual,
} from '@offisim/core/browser';
import type { NotificationBridge } from '@offisim/core/services';
import { ENGINE_IDS, type EmployeeRuntimeBinding, type EngineId } from '@offisim/shared-types';
import {
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
  type OffisimRuntimeStatusValue,
  type OffisimRuntimeValue,
  useChatStreamingSync,
} from '@offisim/ui-office/web';
import { useMemo, useRef } from 'react';
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
  const servicesValue = useMemo<OffisimRuntimeServicesValue>(() => {
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
      installService: runtime?.installService ?? null,
      repos: runtime?.repos ?? null,
      employeeVersionService,
      toolTelemetryService: runtime?.toolTelemetryService ?? null,
      skillLoader: runtime?.skillLoader ?? null,
      connectMcpServer,
      disconnectMcpServer,
      connectedMcpServers,
      listRecentDeliverables,
      loadDeliverableContent,
      availableEngineAdapters: lastAdaptersRef.current,
      companyEmployeeRuntimeDefault: lastCompanyDefaultRef.current,
      attachmentStore: runtime?.attachmentStore ?? null,
    };
  }, [
    version,
    eventBus,
    sceneIntentBus,
    runtime,
    employeeVersionService,
    connectMcpServer,
    disconnectMcpServer,
    connectedMcpServers,
    listRecentDeliverables,
    loadDeliverableContent,
  ]);

  const executionValue = useMemo<OffisimRuntimeExecutionValue>(
    () => ({
      isReady: !isInitializing && isRuntimeReadyForInteraction(runtime),
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
      abortExecution,
      unfinishedThreads,
      dismissUnfinishedThreads,
      resumeThread,
    }),
    [
      isInitializing,
      runtime,
      error,
      failedRunState,
      sendMessage,
      retryLastMessage,
      clearError,
      reinit,
      abortExecution,
      unfinishedThreads,
      dismissUnfinishedThreads,
      resumeThread,
    ],
  );

  const interactionValue = useMemo<OffisimRuntimeInteractionValue>(
    () => ({
      interactionMode,
      pendingInteraction,
      setInteractionMode,
      respondToInteraction,
    }),
    [interactionMode, pendingInteraction, setInteractionMode, respondToInteraction],
  );

  const desktopHostValue = useMemo<OffisimRuntimeDesktopHostValue>(
    () => ({
      desktopVaultRoot: runtime?.desktopVaultRoot ?? null,
    }),
    [runtime],
  );

  const value = useMemo<OffisimRuntimeValue>(() => {
    if (shouldExposeDebugBridge) {
      const existingGetSceneState = window.__OFFISIM_DEBUG__?.getSceneState;
      window.__OFFISIM_DEBUG__ = {
        eventBus,
        sceneIntentBus,
        installService: servicesValue.installService,
        repos: servicesValue.repos,
        companyId,
        pendingInteraction: interactionValue.pendingInteraction ?? null,
        respondToInteraction: interactionValue.respondToInteraction,
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
            return {
              employeeCount: 0,
              employeeIds: [],
            };
          }),
      };
    }

    return {
      ...servicesValue,
      ...executionValue,
      ...interactionValue,
      ...desktopHostValue,
      get isRunning() {
        return isRunningRef.current;
      },
    };
  }, [
    servicesValue,
    executionValue,
    interactionValue,
    desktopHostValue,
    isRunningRef,
    sendMessage,
    abortExecution,
    eventBus,
    sceneIntentBus,
    companyId,
    runtimeRef,
  ]);

  return (
    <OffisimRuntimeStatusContext.Provider value={statusValue}>
      <OffisimRuntimeServicesContext.Provider value={servicesValue}>
        <OffisimRuntimeExecutionContext.Provider value={executionValue}>
          <OffisimRuntimeInteractionContext.Provider value={interactionValue}>
            <OffisimRuntimeDesktopHostContext.Provider value={desktopHostValue}>
              <OffisimRuntimeContext.Provider value={value}>
                {children}
              </OffisimRuntimeContext.Provider>
            </OffisimRuntimeDesktopHostContext.Provider>
          </OffisimRuntimeInteractionContext.Provider>
        </OffisimRuntimeExecutionContext.Provider>
      </OffisimRuntimeServicesContext.Provider>
    </OffisimRuntimeStatusContext.Provider>
  );
}
