import {
  EmployeeVersionService,
  InMemoryEventBus,
  TOOL_PERMISSION_REQUIRED,
} from '@offisim/core/browser';
import type { McpServerConfig } from '@offisim/core/browser';
import { disposeRuntime } from '@offisim/core/dist/runtime/runtime-context.js';
import { NotificationBridge } from '@offisim/core/dist/services/notification-bridge.js';
import {
  AGENT_QUESTION_REQUIRED,
  PLAN_REVIEW_REQUIRED,
  type RuntimeEvent,
} from '@offisim/shared-types';
import type {
  InteractionMode,
  InteractionModeChangedPayload,
  InteractionRequest,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
} from '@offisim/shared-types';
import {
  InMemorySceneIntentBus,
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeStatusValue,
  type OffisimRuntimeValue,
  SceneIntentDispatcher,
  disposeEventLogStore,
  isTauri,
  loadProviderConfig,
  loadStoredBrowserMcpServers,
  useChatStreamingSync,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeBundle } from '../lib/browser-runtime';
import {
  loadBrowserRuntimeBootstrapState,
  loadBrowserRuntimeSnapshot,
} from '../lib/browser-runtime-storage';
import { listDesktopMcpServers } from '../lib/desktop-mcp-registry';
import { initializeRuntimeBundle } from './initialize-runtime';
import { getInteractionFollowUp } from './interaction-follow-up';
import { isRuntimeReadyForInteraction } from './runtime-readiness';

export interface UnfinishedThread {
  threadId: string;
  projectName: string;
}

interface Props {
  companyId: string;
  children: React.ReactNode;
}

const INTERACTION_MODE_KEY = 'offisim.interaction-mode.default';

function loadDefaultInteractionMode(): InteractionMode {
  if (typeof window === 'undefined') return 'boss_proxy';
  const raw = window.localStorage.getItem(INTERACTION_MODE_KEY);
  return raw === 'human_in_loop' ? 'human_in_loop' : 'boss_proxy';
}

function persistDefaultInteractionMode(mode: InteractionMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INTERACTION_MODE_KEY, mode);
}

function isInteractionRequiredError(message: string): boolean {
  return (
    message.includes(TOOL_PERMISSION_REQUIRED) ||
    message.includes(PLAN_REVIEW_REQUIRED) ||
    message.includes(AGENT_QUESTION_REQUIRED)
  );
}

function parseExplicitUserMemory(text: string): string | null {
  const trimmed = text.trim();
  const prefixed = trimmed.match(/^remember(?:\s+this)?\s+user\s+(?:fact|preference)\s*:\s*(.+)$/i);
  if (prefixed?.[1]) return prefixed[1].trim();

  const rememberThat = trimmed.match(/^remember\s+that\s+i\s+(.+)$/i);
  if (rememberThat?.[1]) {
    return `I ${rememberThat[1].trim()}`;
  }

  return null;
}

type DesktopMcpServerConfig = McpServerConfig & {
  registeredServerId?: string;
};

export function OffisimRuntimeProvider({ companyId, children }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [connectedMcpServers, setConnectedMcpServers] = useState<ReadonlySet<string>>(new Set());
  const [unfinishedThreads, setUnfinishedThreads] = useState<UnfinishedThread[]>([]);
  const [interactionMode, setInteractionModeState] = useState<InteractionMode>(
    loadDefaultInteractionMode,
  );
  const [pendingInteraction, setPendingInteraction] = useState<InteractionRequest | null>(null);

  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const initPromiseRef = useRef<Promise<RuntimeBundle | null> | null>(null);
  const detectionDoneRef = useRef(false);
  const bootstrapStateRef = useRef(loadBrowserRuntimeBootstrapState());
  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const pendingInteractionRef = useRef(pendingInteraction);
  pendingInteractionRef.current = pendingInteraction;

  // ---------------------------------------------------------------------------
  // Stable EventBus — created once, shared across runtime reinitializations.
  //
  // KEY DESIGN DECISION: The EventBus is the pub/sub backbone that connects
  // core graph execution → UI hooks (useEventStream, useScene, useAgentStates).
  // By sharing ONE instance across the Provider's lifetime:
  //   1. No "EventBus churn" — hooks subscribe once, never re-subscribe
  //   2. No SceneManager mount/destroy cycles during Tauri async init
  //   3. Debug bridge always has the correct bus reference
  //   4. Runtime reinit (e.g. user changes provider) reuses the same bus
  //      — old subscriptions automatically receive events from the new runtime
  // ---------------------------------------------------------------------------
  const eventBusRef = useRef(new InMemoryEventBus());
  const sceneIntentBusRef = useRef(new InMemorySceneIntentBus());
  const notificationBridgeRef = useRef<NotificationBridge | null>(null);

  useChatStreamingSync(eventBusRef.current);

  // Activate NotificationBridge once — subscribes to runtime events on the
  // stable EventBus and emits `notification.created` for the UI.
  useEffect(() => {
    const bridge = new NotificationBridge(eventBusRef.current, companyId);
    bridge.activate();
    notificationBridgeRef.current = bridge;
    return () => {
      bridge.deactivate();
      notificationBridgeRef.current = null;
    };
  }, [companyId]);

  useEffect(() => {
    const dispatcher = new SceneIntentDispatcher(eventBusRef.current, sceneIntentBusRef.current);
    dispatcher.activate();
    return () => {
      dispatcher.deactivate();
      sceneIntentBusRef.current.removeAll();
    };
  }, []);

  // Bridge meeting control UI events onto the orchestration service.
  // Running meetings consume pause/end/inject via interruptMeeting();
  // paused meetings need an explicit resume/end invocation because no graph is active.
  useEffect(() => {
    const eventBus = eventBusRef.current;

    const unsubPause = eventBus.on('meeting.interrupt.pause', () => {
      runtimeRef.current?.orch?.interruptMeeting('pause');
    });

    const unsubInject = eventBus.on('meeting.interrupt.inject', (event) => {
      const payload = event.payload as { comment?: string } | undefined;
      runtimeRef.current?.orch?.interruptMeeting('inject', payload?.comment);
    });

    const unsubResume = eventBus.on('meeting.interrupt.resume', (event) => {
      const runtime = runtimeRef.current;
      const orch = runtime?.orch;
      const meetingId = (event.payload as { meetingId?: string } | undefined)?.meetingId;
      if (!orch || !meetingId) return;

      void (async () => {
        const meeting = await runtime.repos?.meetings.findById(meetingId);
        if (!meeting || meeting.status !== 'paused') return;

        setIsRunning(true);
        try {
          const { HumanMessage } = await import('@langchain/core/messages');
          await orch.resumeMeeting(
            meetingId,
            [new HumanMessage('Resume meeting')],
            meeting.thread_id ?? undefined,
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsRunning(false);
        }
      })();
    });

    const unsubEnd = eventBus.on('meeting.interrupt.end', (event) => {
      const runtime = runtimeRef.current;
      const orch = runtime?.orch;
      const meetingId = (event.payload as { meetingId?: string } | undefined)?.meetingId;
      if (!orch || !meetingId) return;

      void (async () => {
        const meeting = await runtime.repos?.meetings.findById(meetingId);
        if (!meeting) return;

        if (meeting.status === 'paused') {
          setIsRunning(true);
          try {
            const { HumanMessage } = await import('@langchain/core/messages');
            await orch.endPausedMeeting(
              meetingId,
              [new HumanMessage('End meeting')],
              meeting.thread_id ?? undefined,
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setIsRunning(false);
          }
          return;
        }

        orch.interruptMeeting('end');
      })();
    });

    return () => {
      unsubPause();
      unsubInject();
      unsubResume();
      unsubEnd();
    };
  }, []);

  useEffect(() => {
    const eventBus = eventBusRef.current;

    const offRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        setPendingInteraction(event.payload.request);
      },
    );
    const offResolved = eventBus.on(
      'interaction.resolved',
      (_event: RuntimeEvent<InteractionResolvedPayload>) => {
        setPendingInteraction(null);
      },
    );
    const offMode = eventBus.on(
      'interaction.mode.changed',
      (event: RuntimeEvent<InteractionModeChangedPayload>) => {
        setInteractionModeState(event.payload.nextMode);
      },
    );

    return () => {
      offRequested();
      offResolved();
      offMode();
    };
  }, []);

  // Full dispose on unmount — release gateway, MCP connections, EventBus subs.
  useEffect(() => {
    return () => {
      disposeEventLogStore(eventBusRef.current);
      const runtime = runtimeRef.current;
      if (runtime) {
        runtime.dispose?.();
        disposeRuntime({
          llmGateway: runtime.runtimeCtx?.llmGateway,
          eventBus: eventBusRef.current,
          toolExecutor: runtime.mcpToolExecutor ?? undefined,
          notificationBridge: notificationBridgeRef.current ?? undefined,
        });
      }
    };
  }, []);

  // Async runtime init (Tauri + browser modes — both async due to seedCostRates)
  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    const eventBus = eventBusRef.current;
    const runtime = await initializeRuntimeBundle(config, eventBus, isTauri(), companyId, {
      defaultInteractionMode: interactionModeRef.current,
    });
    if (runtime?.interactionService) {
      const pending = pendingInteractionRef.current;
      if (pending) {
        runtime.interactionService.hydratePending(pending);
      }
      setInteractionModeState(runtime.interactionService.getMode());
      setPendingInteraction(runtime.interactionService.getPending());
    }
    runtimeRef.current = runtime;
    return runtime;
  }, [companyId]);

  function getRuntime(): RuntimeBundle | null {
    return runtimeRef.current ?? null;
  }

  // Initialize runtime on mount / reinit (both Tauri and browser modes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is intentional — reinitRuntime() bumps it to force re-init
  useEffect(() => {
    if (!runtimeRef.current && !initPromiseRef.current) {
      setIsInitializing(true);
      initPromiseRef.current = initRuntime()
        .then((runtime) => {
          // Bump version so effects that depend on runtime being ready
          // (MCP auto-connect, unfinished-thread detection) re-fire.
          // Safe: init guard checks runtimeRef.current, which is now set,
          // so this version bump won't cause a re-init loop.
          setVersion((v) => v + 1);
          setIsInitializing(false);
          return runtime;
        })
        .catch((err) => {
          console.error('[Runtime] init failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setIsInitializing(false);
          return null;
        });
    }
  }, [initRuntime, version]);

  const reinitRuntime = useCallback(() => {
    // Dispose the OLD runtime's disposable resources (gateway, MCP connections)
    // before creating a new one. The EventBus is intentionally NOT disposed here
    // — it's shared across reinits so UI hooks stay subscribed.
    const oldRuntime = runtimeRef.current;
    if (oldRuntime) {
      bootstrapStateRef.current = loadBrowserRuntimeBootstrapState();
      oldRuntime.dispose?.();
      disposeRuntime({
        llmGateway: oldRuntime.runtimeCtx?.llmGateway,
        // eventBus intentionally omitted: keep shared EventBus alive across reinits
        toolExecutor: oldRuntime.mcpToolExecutor ?? undefined,
        notificationBridge: notificationBridgeRef.current ?? undefined,
      });
    }
    runtimeRef.current = null;
    initPromiseRef.current = null;
    detectionDoneRef.current = false;
    setVersion((v) => v + 1);
  }, []);

  const lastFailedMessageRef = useRef<{
    text: string;
    targetEmployeeId?: string;
    threadId?: string;
    entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces fresh runtime; getRuntime is a render-scoped function that reads refs
  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        targetEmployeeId?: string;
        threadId?: string;
        entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      },
    ): Promise<string | undefined> => {
      let runtime = runtimeRef.current;

      // Wait for async init if in progress (both Tauri and browser modes)
      if (!runtime) {
        if (initPromiseRef.current) {
          runtime = await initPromiseRef.current;
        } else {
          runtime = await initRuntime();
        }
      }

      if (!runtime) {
        setError('No provider configured. Open Settings to configure.');
        return undefined;
      }

      setIsRunning(true);
      setError(null);
      lastFailedMessageRef.current = null;

      try {
        // HumanMessage is still dynamically imported to avoid including
        // @langchain/core/messages in the initial bundle.
        const { HumanMessage } = await import('@langchain/core/messages');
        if (!runtime.orch) {
          setError('Runtime not fully initialized (no orchestration service).');
          return undefined;
        }
        const explicitMemory = parseExplicitUserMemory(text);
        if (explicitMemory && runtime.userMemoryService) {
          await runtime.userMemoryService.saveExplicit(
            companyId,
            explicitMemory,
            'preference',
            options?.threadId ?? runtime.runtimeCtx.threadId,
          );
        }
        const entryMode =
          options?.entryMode ?? (options?.targetEmployeeId ? 'direct_chat' : 'boss_chat');
        const result = await runtime.orch.execute({
          entryMode,
          messages: [new HumanMessage(text)],
          targetEmployeeId: options?.targetEmployeeId ?? null,
          threadId: options?.threadId,
        });
        // Extract last AI message content from graph result
        const msgs = result.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (!m) continue;
          if (m._getType() === 'ai' && typeof m.content === 'string' && m.content) {
            return m.content;
          }
        }
        return undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastFailedMessageRef.current = {
          text,
          targetEmployeeId: options?.targetEmployeeId,
          threadId: options?.threadId,
          entryMode: options?.entryMode,
        };
        if (isInteractionRequiredError(msg) && runtime?.interactionService?.getPending()) {
          setError(null);
          return undefined;
        }
        setError(msg);
        return undefined;
      } finally {
        setIsRunning(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version ensures fresh runtime
    },
    [version, initRuntime],
  );

  const retryLastMessage = useCallback(async (): Promise<string | undefined> => {
    const last = lastFailedMessageRef.current;
    if (!last) return undefined;
    return sendMessage(last.text, {
      targetEmployeeId: last.targetEmployeeId,
      threadId: last.threadId,
      entryMode: last.entryMode,
    });
  }, [sendMessage]);

  const clearError = useCallback(() => setError(null), []);

  const dismissUnfinishedThreads = useCallback(() => setUnfinishedThreads([]), []);

  const setInteractionMode = useCallback((mode: InteractionMode) => {
    setInteractionModeState(mode);
    persistDefaultInteractionMode(mode);
    runtimeRef.current?.interactionService?.setMode(mode);
  }, []);

  const respondToInteraction = useCallback(
    async (selectedOptionId: string, freeformResponse?: string): Promise<string | undefined> => {
      const runtime = runtimeRef.current;
      const interactionService = runtime?.interactionService;
      const pending = interactionService?.getPending() ?? pendingInteraction;
      if (!pending || !interactionService) return undefined;

      await interactionService.resolve({
        interactionId: pending.interactionId,
        selectedOptionId,
        freeformResponse,
        respondedAt: Date.now(),
      });

      const followUp = getInteractionFollowUp(pending, { selectedOptionId });

      if (followUp.mode === 'message') {
        return followUp.message;
      }

      if (followUp.mode === 'retry_last_message' && lastFailedMessageRef.current) {
        setError(null);
        return retryLastMessage();
      }

      if (followUp.mode === 'resend_with_clarification' && lastFailedMessageRef.current) {
        const answer = freeformResponse?.trim();
        if (!answer) return undefined;

        const last = lastFailedMessageRef.current;
        setError(null);
        return sendMessage(`${last.text}\n\nUser clarification: ${answer}`, {
          targetEmployeeId: last.targetEmployeeId,
          threadId: last.threadId,
          entryMode: last.entryMode,
        });
      }
      return undefined;
    },
    [pendingInteraction, retryLastMessage, sendMessage],
  );

  const resumeThread = useCallback(async (threadId: string): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime?.orch) return;

    setIsRunning(true);
    setError(null);

    try {
      await runtime.orch.resumePlan(threadId, { skipCompletedSteps: true });
      // Clear the resumed thread from the unfinished list
      setUnfinishedThreads((prev) => prev.filter((t) => t.threadId !== threadId));
    } catch (err) {
      console.error('Failed to resume thread:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsRunning(false);
    }
  }, []);

  // --- MCP server management ---
  const connectMcpServer = useCallback(async (config: McpServerConfig): Promise<number> => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) {
      throw new Error('Runtime not ready — cannot connect MCP server.');
    }
    await runtime.mcpToolExecutor.addServer(config);
    setConnectedMcpServers((prev) => new Set([...prev, config.name]));
    // Return tool count — serverCount is available but we want tool count
    // Approximation: return serverCount as a signal that connection succeeded
    return runtime.mcpToolExecutor.serverCount;
  }, []);

  const disconnectMcpServer = useCallback(async (name: string): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;
    await runtime.mcpToolExecutor.removeServer(name);
    setConnectedMcpServers((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const abortExecution = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.orch) return;
    runtime.orch.abortExecution(runtime.runtimeCtx.threadId);
  }, []);

  // Auto-connect saved MCP servers on runtime init
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers reconnect on reinit
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;

    const connectSavedServers = async () => {
      if (isTauri()) {
        const configs = await listDesktopMcpServers();
        const executor = runtime.mcpToolExecutor;
        if (!executor) return;
        for (const cfg of configs) {
          const serverConfig: DesktopMcpServerConfig = {
            name: cfg.name,
            transport: cfg.transport,
            registeredServerId: cfg.serverId,
            url: cfg.url,
          };
          executor
            .addServer(serverConfig)
            .then(() => {
              setConnectedMcpServers((prev) => new Set([...prev, cfg.name]));
            })
            .catch((err) => {
              console.warn(`[MCP] Failed to auto-connect server '${cfg.name}':`, err);
            });
        }
        return;
      }

      try {
        const configs = loadStoredBrowserMcpServers();
        if (configs.length === 0) return;

        const executor = runtime.mcpToolExecutor;
        if (!executor) return;
        for (const cfg of configs) {
          const serverConfig: McpServerConfig = {
            name: cfg.name,
            transport: cfg.transport,
            url: cfg.url,
            command: cfg.command,
            args: cfg.args,
          };
          executor
            .addServer(serverConfig)
            .then(() => {
              setConnectedMcpServers((prev) => new Set([...prev, cfg.name]));
            })
            .catch((err) => {
              console.warn(`[MCP] Failed to auto-connect server '${cfg.name}':`, err);
            });
        }
      } catch {
        // Ignore parse errors
      }
    };

    void connectSavedServers();
  }, [version]);

  // Startup detection — find threads that were left in 'running' status
  // (e.g. app crashed or was closed mid-execution). Runs once per init cycle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version ensures re-run after async runtime init completes
  useEffect(() => {
    if (detectionDoneRef.current) return;
    const runtime = runtimeRef.current;
    if (!runtime?.repos) return;

    detectionDoneRef.current = true;

    (async () => {
      try {
        const threads = await runtime.repos.threads.findByCompany(companyId, { status: 'running' });
        if (threads.length === 0) {
          setUnfinishedThreads([]);
          return;
        }
        // Enrich with project names — single query, no N+1.
        const allProjects = await runtime.repos.projects.findByCompany(companyId);
        const enriched: UnfinishedThread[] = threads.map((t) => {
          const project = allProjects.find((p) => p.thread_id === t.thread_id);
          return {
            threadId: t.thread_id,
            projectName: project?.name ?? t.thread_id,
          };
        });
        setUnfinishedThreads(enriched);
      } catch {
        // Silent fail — startup detection must never block the UI
      }
    })();
  }, [companyId, version]);

  // ---------------------------------------------------------------------------
  // EmployeeVersionService — only recreated when runtime changes (version bump).
  // Extracted from the main value useMemo to avoid recreation on every
  // unrelated state change (error, connectedMcpServers, etc.).
  // ---------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: version signals runtime readiness; getRuntime reads ref
  const employeeVersionService = useMemo(() => {
    const runtime = getRuntime();
    if (!runtime?.repos) return null;
    return new EmployeeVersionService(
      runtime.repos.employeeVersions,
      runtime.repos.employees,
      eventBusRef.current,
      runtime.repos.transact,
    );
  }, [version]);

  // ---------------------------------------------------------------------------
  // Volatile status — changes on every task execution (isRunning toggle).
  // Separated so that consumers of stable values (repos, eventBus) don't
  // re-render when isRunning flips.
  // ---------------------------------------------------------------------------
  const statusValue = useMemo<OffisimRuntimeStatusValue>(
    () => ({ isRunning, version }),
    [isRunning, version],
  );

  // ---------------------------------------------------------------------------
  // Stable context — repos, eventBus, sendMessage, etc.
  // Only rebuilds when the runtime itself changes (version/init), error changes,
  // or MCP server set changes. NOT on isRunning toggles.
  // ---------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces reinit; getRuntime is a render-scoped function
  const value = useMemo<OffisimRuntimeValue>(() => {
    // Runtime initialization is async (both browser and Tauri). On first render
    // getRuntime() returns null. The useEffect above kicks off initRuntime(),
    // which sets runtimeRef.current and bumps version to trigger a re-render.
    const runtime = getRuntime();

    // Always use the stable shared EventBus — never create a temporary one.
    // This is the same instance passed to createBrowserRuntime / createTauriRuntime,
    // so hooks subscribed to it will receive events from any runtime incarnation.
    const eventBus = eventBusRef.current;
    const sceneIntentBus = sceneIntentBusRef.current;

    // Expose debug bridge in dev mode (E2E smoke tests).
    // Always set — even before runtime is ready — so tests can access the
    // EventBus for subscription-based assertions during async init.
    // `getSceneState` reads the persisted memory-repos snapshot filtered by
    // the active company. Persistence debounces writes every 300ms / 5s so
    // this stays in sync with live runtime state. Preserve any getSceneState
    // a downstream component (e.g. SceneManager) may have registered first.
    if (import.meta.env.DEV) {
      const existingGetSceneState = window.__OFFISIM_DEBUG__?.getSceneState;
      window.__OFFISIM_DEBUG__ = {
        eventBus,
        sceneIntentBus,
        installService: runtime?.installService ?? null,
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

    return {
      eventBus,
      sceneIntentBus,
      isReady: !isInitializing && isRuntimeReadyForInteraction(runtime),
      // isRunning lives in OffisimRuntimeStatusContext — use useOffisimRuntimeStatus().
      // Kept here as a getter for backward compat (does NOT trigger re-render).
      get isRunning() {
        return isRunningRef.current;
      },
      error,
      sendMessage,
      retryLastMessage,
      clearError,
      reinitRuntime,
      installService: runtime?.installService ?? null,
      repos: runtime?.repos ?? null,
      employeeVersionService,
      toolTelemetryService: runtime?.toolTelemetryService ?? null,
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [
    isInitializing,
    error,
    sendMessage,
    retryLastMessage,
    clearError,
    reinitRuntime,
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
  ]);

  return (
    <OffisimRuntimeStatusContext.Provider value={statusValue}>
      <OffisimRuntimeContext.Provider value={value}>{children}</OffisimRuntimeContext.Provider>
    </OffisimRuntimeStatusContext.Provider>
  );
}
