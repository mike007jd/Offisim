import {
  InMemoryEventBus,
  type McpServerConfig,
  TOOL_PERMISSION_REQUIRED,
} from '@offisim/core/browser';
import { disposeRuntime } from '@offisim/core/runtime';
import type { NotificationBridge } from '@offisim/core/services';
import {
  AGENT_QUESTION_REQUIRED,
  PLAN_REVIEW_REQUIRED,
  isChatRuntimeOutcomeKind,
} from '@offisim/shared-types';
import type { InteractionMode, RunScope } from '@offisim/shared-types';
import {
  type DeliverableHookRow,
  type SendMessageResult,
  disposeEventLogStore,
  getConversationKey,
  loadProviderConfig,
  mapDeliverableFullRowToHookRow,
  terminateRunAsInterrupted,
  terminateRunWithError,
} from '@offisim/ui-office/web';
import type { ProviderConfig } from '@offisim/ui-office/web';
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { listDesktopMcpServers } from '../../lib/desktop-mcp-registry';
import type { RuntimeBundle } from '../../lib/runtime-bundle';
import { isNoCredentialError } from '../../lib/tauri-llm-fetch';
import { getChatRuntimeOutcomeFollowUp } from '../interaction-follow-up';
import type { FailedRunState, LastFailedMessage } from '../last-failed-message';

type DesktopMcpServerConfig = McpServerConfig & {
  registeredServerId?: string;
  approvalId?: string;
  commandFingerprint?: string;
};

function isInteractionRequiredError(message: string): boolean {
  return (
    message.includes(TOOL_PERMISSION_REQUIRED) ||
    message.includes(PLAN_REVIEW_REQUIRED) ||
    message.includes(AGENT_QUESTION_REQUIRED)
  );
}

function isAbortLikeError(err: unknown, message: string): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError') ||
    message === 'The operation was aborted.' ||
    message === 'Request aborted' ||
    message === 'Engine run aborted'
  );
}

function parseExplicitUserMemory(text: string): string | null {
  const trimmed = text.trim();
  const prefixed = trimmed.match(/^remember(?:\s+this)?\s+user\s+(?:fact|preference)\s*:\s*(.+)$/i);
  if (prefixed?.[1]) return prefixed[1].trim();
  const rememberThat = trimmed.match(/^remember\s+that\s+i\s+(.+)$/i);
  if (rememberThat?.[1]) return `I ${rememberThat[1].trim()}`;
  return null;
}

const DIRECT_CHAT_TARGET_MISSING_ERROR =
  'Direct chat target missing — selectedEmployeeId not propagated';

async function buildRuntimeBundle(
  config: ProviderConfig | null,
  eventBus: InMemoryEventBus,
  companyId: string,
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle | null> {
  if (!config) {
    const { createTauriRuntimeReposOnly } = await import('../../lib/tauri-runtime-lite');
    return createTauriRuntimeReposOnly(eventBus, companyId, opts);
  }
  const { createTauriRuntime } = await import('../../lib/tauri-runtime');
  return createTauriRuntime(config, eventBus, companyId, opts);
}

export interface UseRuntimeInitResult {
  runtime: RuntimeBundle | null;
  runtimeRef: MutableRefObject<RuntimeBundle | null>;
  initPromiseRef: MutableRefObject<Promise<RuntimeBundle | null> | null>;
  detectionDoneRef: MutableRefObject<boolean>;
  lastFailedMessageRef: MutableRefObject<LastFailedMessage | null>;
  eventBus: InMemoryEventBus;
  isInitializing: boolean;
  error: string | null;
  failedRunState: FailedRunState | null;
  setError: Dispatch<SetStateAction<string | null>>;
  clearError: () => void;
  version: number;
  reinit: () => void;
  isRunning: boolean;
  isRunningRef: MutableRefObject<boolean>;
  setIsRunning: Dispatch<SetStateAction<boolean>>;
  connectedMcpServers: ReadonlySet<string>;
  connectMcpServer: (config: McpServerConfig) => Promise<number>;
  disconnectMcpServer: (name: string) => Promise<void>;
  abortExecution: () => void;
  sendMessage: (
    text: string,
    options?: {
      targetEmployeeId?: string;
      threadId?: string;
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      conversationKey?: string;
      runScope?: RunScope;
    },
  ) => Promise<SendMessageResult | undefined>;
  retryLastMessage: (options?: {
    runScope?: RunScope;
  }) => Promise<SendMessageResult | undefined>;
  listRecentDeliverables: (opts?: {
    threadId?: string;
    limit?: number;
  }) => Promise<DeliverableHookRow[]>;
  loadDeliverableContent: (deliverableId: string) => Promise<DeliverableHookRow | null>;
}

export function useRuntimeInit({
  companyId,
  notificationBridgeRef,
  getDefaultInteractionMode,
}: {
  companyId: string;
  notificationBridgeRef: MutableRefObject<NotificationBridge | null>;
  getDefaultInteractionMode: () => InteractionMode;
}): UseRuntimeInitResult {
  const eventBusRef = useRef(new InMemoryEventBus());
  const eventBus = eventBusRef.current;

  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;
  const [error, setError] = useState<string | null>(null);
  const [failedRunState, setFailedRunState] = useState<FailedRunState | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [connectedMcpServers, setConnectedMcpServers] = useState<ReadonlySet<string>>(new Set());

  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const initPromiseRef = useRef<Promise<RuntimeBundle | null> | null>(null);
  const detectionDoneRef = useRef(false);
  const lastFailedMessageRef = useRef<LastFailedMessage | null>(null);
  const activeExecutionThreadIdRef = useRef<string | null>(null);

  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    const runtime = await buildRuntimeBundle(config, eventBus, companyId, {
      defaultInteractionMode: getDefaultInteractionMode(),
    });
    runtimeRef.current = runtime;
    return runtime;
  }, [companyId, eventBus, getDefaultInteractionMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is intentional — reinit() bumps it to force re-init
  useEffect(() => {
    if (!runtimeRef.current && !initPromiseRef.current) {
      setIsInitializing(true);
      initPromiseRef.current = initRuntime()
        .then((runtime) => {
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
  }, [notificationBridgeRef]);

  const reinit = useCallback(() => {
    const oldRuntime = runtimeRef.current;
    if (oldRuntime) {
      oldRuntime.dispose?.();
      // eventBus and notificationBridge intentionally omitted: both are keyed to
      // the Provider's lifetime (not the runtime's), so they must survive reinit.
      // Otherwise the bridge gets deactivated here but never re-activated (its
      // useEffect deps don't change on same-company reinit).
      disposeRuntime({
        llmGateway: oldRuntime.runtimeCtx?.llmGateway,
        toolExecutor: oldRuntime.mcpToolExecutor ?? undefined,
      });
    }
    runtimeRef.current = null;
    initPromiseRef.current = null;
    detectionDoneRef.current = false;
    setVersion((v) => v + 1);
  }, []);

  const clearFailedRunError = useCallback(() => {
    setError(null);
    setFailedRunState(null);
  }, []);

  const setRetryableFailedRun = useCallback((failedMessage: LastFailedMessage, message: string) => {
    setFailedRunState({
      ...failedMessage,
      message,
    });
    setError(message);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces fresh runtime; runtimeRef reads current
  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        targetEmployeeId?: string;
        threadId?: string;
        projectId?: string | null;
        entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
        conversationKey?: string;
        runScope?: RunScope;
      },
    ): Promise<SendMessageResult | undefined> => {
      let runtime = runtimeRef.current;
      if (!runtime) {
        runtime = initPromiseRef.current ? await initPromiseRef.current : await initRuntime();
      }
      if (!runtime) {
        setError('No provider configured. Open Settings to configure.');
        return undefined;
      }

      setIsRunning(true);
      clearFailedRunError();
      lastFailedMessageRef.current = null;

      try {
        const { HumanMessage } = await import('@langchain/core/messages');
        if (!runtime.orch) {
          const message =
            'Runtime not ready for AI work: no provider credential is configured. Company setup and editing are still available.';
          setError(message);
          return { kind: 'system', content: message };
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
        if (entryMode === 'direct_chat' && !options?.targetEmployeeId) {
          throw new Error(DIRECT_CHAT_TARGET_MISSING_ERROR);
        }
        const executionThreadId = options?.threadId ?? runtime.runtimeCtx.threadId;
        activeExecutionThreadIdRef.current = executionThreadId;
        const result = await runtime.orch.execute({
          entryMode,
          messages: [new HumanMessage(text)],
          targetEmployeeId: options?.targetEmployeeId ?? null,
          threadId: executionThreadId,
          projectId: options?.projectId ?? null,
          ...(options?.runScope ? { runScope: options.runScope } : {}),
        });
        const msgs = result.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (!m) continue;
          if (m._getType() === 'ai' && typeof m.content === 'string' && m.content) {
            if (isChatRuntimeOutcomeKind(m.content)) {
              const followUp = getChatRuntimeOutcomeFollowUp(m.content);
              if (followUp.mode === 'message') {
                return { kind: 'system', content: followUp.message };
              }
              return undefined;
            }
            return { kind: 'assistant', content: m.content };
          }
        }
        return undefined;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const nextFailedMessage: LastFailedMessage = {
          text,
          targetEmployeeId: options?.targetEmployeeId,
          threadId: options?.threadId,
          projectId: options?.projectId ?? null,
          entryMode: options?.entryMode,
          conversationKey:
            options?.conversationKey ??
            getConversationKey({
              projectId: options?.projectId,
              threadId: options?.threadId,
              targetEmployeeId: options?.targetEmployeeId,
            }),
        };
        lastFailedMessageRef.current = nextFailedMessage;
        if (isInteractionRequiredError(message) && runtime?.interactionService?.getPending()) {
          clearFailedRunError();
          return undefined;
        }
        if (isAbortLikeError(err, message)) {
          terminateRunAsInterrupted();
          clearFailedRunError();
          return undefined;
        }
        terminateRunWithError();
        const displayMessage = isNoCredentialError(err)
          ? 'No provider credential stored on this device. Open Settings → Provider to enter your API key.'
          : message;
        setRetryableFailedRun(nextFailedMessage, displayMessage);
        return undefined;
      } finally {
        activeExecutionThreadIdRef.current = null;
        setIsRunning(false);
      }
    },
    [version, initRuntime, companyId, clearFailedRunError, setRetryableFailedRun],
  );

  const retryLastMessage = useCallback(
    async (options?: { runScope?: RunScope }): Promise<SendMessageResult | undefined> => {
      const last = lastFailedMessageRef.current;
      if (!last) return undefined;
      return sendMessage(last.text, {
        targetEmployeeId: last.targetEmployeeId,
        threadId: last.threadId,
        projectId: last.projectId ?? null,
        entryMode: last.entryMode,
        conversationKey: last.conversationKey,
        ...(options?.runScope ? { runScope: options.runScope } : {}),
      });
    },
    [sendMessage],
  );

  const connectMcpServer = useCallback(async (config: McpServerConfig): Promise<number> => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) {
      throw new Error('Runtime not ready — cannot connect MCP server.');
    }
    await runtime.mcpToolExecutor.addServer(config);
    setConnectedMcpServers((prev) => new Set([...prev, config.name]));
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
    runtime.orch.abortExecution(activeExecutionThreadIdRef.current ?? runtime.runtimeCtx.threadId);
  }, []);

  const listRecentDeliverables = useCallback(
    async (opts?: { threadId?: string; limit?: number }): Promise<DeliverableHookRow[]> => {
      const runtime = runtimeRef.current;
      const repo = runtime?.repos?.deliverables;
      if (!repo) return [];
      try {
        const rows = await repo.listByCompanyWithContent(companyId, opts);
        return rows.map(mapDeliverableFullRowToHookRow);
      } catch (err) {
        console.error('[OffisimRuntime] listRecentDeliverables failed', err);
        return [];
      }
    },
    [companyId],
  );

  const loadDeliverableContent = useCallback(
    async (deliverableId: string): Promise<DeliverableHookRow | null> => {
      const runtime = runtimeRef.current;
      const repo = runtime?.repos?.deliverables;
      if (!repo) return null;
      try {
        const row = await repo.findById(deliverableId);
        return row ? mapDeliverableFullRowToHookRow(row) : null;
      } catch (err) {
        console.error('[OffisimRuntime] loadDeliverableContent failed', err);
        return null;
      }
    },
    [],
  );

  // Auto-connect saved MCP servers on runtime ready
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers reconnect on reinit
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;

    const connectSavedServers = async () => {
      const configs = await listDesktopMcpServers();
      const executor = runtime.mcpToolExecutor;
      if (!executor) return;
      for (const cfg of configs) {
        const serverConfig: DesktopMcpServerConfig = {
          name: cfg.name,
          transport: cfg.transport,
          registeredServerId: cfg.serverId,
          approvalId: cfg.approvalId,
          commandFingerprint: cfg.commandFingerprint,
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
    };

    void connectSavedServers();
  }, [version]);

  return {
    runtime: runtimeRef.current,
    runtimeRef,
    initPromiseRef,
    detectionDoneRef,
    lastFailedMessageRef,
    eventBus,
    isInitializing,
    error,
    failedRunState,
    setError,
    clearError: clearFailedRunError,
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
  };
}
