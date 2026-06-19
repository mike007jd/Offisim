import { ensureProjectBoundForRun } from '@/runtime/ensure-default-workspace.js';
import { llmStreamChunk, toolExecutionTelemetry } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type { InteractionResponse, SkillInstallOutcomeKind } from '@offisim/shared-types';
import { Channel, invoke } from '@tauri-apps/api/core';
import { readPiModelOverride } from './pi-agent-config.js';
import { getRepos, runtimeEventBus } from './repos.js';

export interface DesktopAgentRunInput {
  text: string;
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  /**
   * Per-turn Pi registry model id (provider/model). When omitted the runtime
   * falls back to the global Settings override, then to Pi's default. Pi still
   * resolves credentials and the real catalog; this only forwards the id.
   */
  model?: string;
}

export interface DesktopAgentRunResult {
  text: string;
  reasoning?: string;
}

export interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

interface PiAgentHostResponse {
  text: string;
  reasoning?: string;
  sessionId?: string;
  sessionFile?: string;
  model?: PiAgentModelSummary;
}

type PiAgentHostEvent =
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
    }
  | { kind: 'messageDelta'; delta: string; channel?: 'content' | 'reasoning' }
  | { kind: 'messageEnd'; text: string; stopReason?: string; errorMessage?: string }
  | {
      kind: 'tool';
      status: 'started' | 'running' | 'completed' | 'failed';
      toolCallId: string;
      toolName: string;
      detail?: string;
      durationMs?: number;
    }
  | { kind: 'result'; response: PiAgentHostResponse }
  | { kind: 'error'; code: string; message: string };

// Wire-contract typecheck guard. These canonical events must stay assignable to
// PiAgentHostEvent; `satisfies` makes tsc fail here if the renderer union drifts
// from the camelCase wire contract shared with the Rust host (pi_agent_host.rs)
// and the Node emitter (scripts/pi-agent-host-wire.mjs). The runtime round-trip is
// gated by check:pi-wire-contract and the cargo fixture test.
export const PI_WIRE_CONTRACT_EXAMPLES = [
  { kind: 'started', sessionId: 's', sessionFile: '/f', modelFallbackMessage: 'm' },
  { kind: 'messageDelta', delta: 'x', channel: 'content' },
  { kind: 'messageDelta', delta: 'r', channel: 'reasoning' },
  { kind: 'messageEnd', text: 't', stopReason: 'end_turn', errorMessage: 'e' },
  {
    kind: 'tool',
    status: 'completed',
    toolCallId: 'c',
    toolName: 'bash',
    detail: 'd',
    durationMs: 1,
  },
  { kind: 'result', response: { text: 't', reasoning: 'r', sessionId: 's', sessionFile: '/f' } },
  { kind: 'error', code: 'upstream', message: 'm' },
] satisfies PiAgentHostEvent[];

export interface DesktopAgentRuntime {
  execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult>;
  abort(threadId: string): void;
  resolveInteraction(response: InteractionResponse): Promise<SkillInstallOutcomeKind | null>;
  resume(threadId: string, projectId?: string | null): Promise<{ finalText: string } | null>;
  dispose(): Promise<void>;
}

function newRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function piRunScope(projectId: string | null, threadId: string, employeeId: string | null) {
  return {
    conversationKey: `${projectId ?? ''}::${threadId}::${employeeId ?? ''}`,
    runId: `pi-${crypto.randomUUID()}`,
    threadId,
  };
}

function toolStatus(status: PiAgentHostEvent & { kind: 'tool' }) {
  if (status.status === 'failed') return 'error' as const;
  if (status.status === 'completed') return 'completed' as const;
  return 'started' as const;
}

class DesktopPiAgentRuntime implements DesktopAgentRuntime {
  private readonly inFlightByThread = new Map<string, string>();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
  ) {}

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    const projectId = await ensureProjectBoundForRun(this.repos, this.companyId, input.projectId);
    const runScope = piRunScope(projectId, input.threadId, input.employeeId);
    const requestId = newRequestId('pi-agent');
    const startedAtByTool = new Map<string, number>();
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;
    const onEvent = new Channel<PiAgentHostEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === 'messageDelta' && event.delta) {
        const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
        if (channel === 'reasoning') {
          reasoningText += event.delta;
        }
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            event.delta,
            channel,
            runScope,
          ),
        );
        return;
      }
      if (event.kind === 'messageEnd' && event.text) {
        finalText = event.text;
        return;
      }
      if (event.kind === 'tool') {
        const startedAt = startedAtByTool.get(event.toolCallId) ?? Date.now();
        if (event.status === 'started') {
          startedAtByTool.set(event.toolCallId, startedAt);
        }
        const completedAt =
          event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
        runtimeEventBus.emit(
          toolExecutionTelemetry(this.companyId, input.threadId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolType: 'builtin',
            evidenceClass: 'sdk-native',
            threadId: input.threadId,
            nodeName: 'pi_agent',
            employeeId: input.employeeId ?? undefined,
            startedAt,
            completedAt,
            durationMs:
              event.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
            status: toolStatus(event),
            errorType: event.status === 'failed' ? (event.detail ?? 'pi_tool_failed') : undefined,
            chatConversationKey: runScope.conversationKey,
            chatRunId: runScope.runId,
          }),
        );
        return;
      }
      if (event.kind === 'result') {
        finalText = event.response.text || finalText;
        return;
      }
      if (event.kind === 'error') {
        channelError = new Error(event.message);
      }
    };

    this.inFlightByThread.set(input.threadId, requestId);
    try {
      const commandResponse = (await invoke('pi_agent_execute', {
        req: {
          requestId,
          text: input.text,
          companyId: this.companyId,
          threadId: input.threadId,
          projectId,
          employeeId: input.employeeId,
          model: input.model?.trim() || readPiModelOverride() || undefined,
        },
        onEvent,
      })) as PiAgentHostResponse;
      if (commandResponse.reasoning && !reasoningText.trim()) {
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            commandResponse.reasoning,
            'reasoning',
            runScope,
          ),
        );
      }
      finalText = commandResponse.text || finalText;
      if (channelError) throw channelError;
      const reasoning = (commandResponse.reasoning || reasoningText).trim();
      return { text: finalText, ...(reasoning ? { reasoning } : {}) };
    } finally {
      if (this.inFlightByThread.get(input.threadId) === requestId) {
        this.inFlightByThread.delete(input.threadId);
      }
    }
  }

  abort(threadId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    void invoke('pi_agent_abort', { requestId }).catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] Pi abort failed', { threadId, err });
    });
  }

  async resume(threadId: string, projectId?: string | null): Promise<{ finalText: string } | null> {
    const thread = await this.repos.threads.findById(threadId);
    const chatThread = await this.repos.chatThreads.findById(threadId);
    const requestedProjectId = projectId ?? thread?.project_id ?? chatThread?.project_id ?? null;
    const text = 'Continue the current Pi Agent session from the last saved state.';
    const result = await this.execute({
      text,
      threadId,
      employeeId: null,
      projectId: requestedProjectId,
    });
    return { finalText: result.text };
  }

  async resolveInteraction(
    _response: InteractionResponse,
  ): Promise<SkillInstallOutcomeKind | null> {
    return null;
  }

  async dispose(): Promise<void> {
    for (const requestId of this.inFlightByThread.values()) {
      await invoke('pi_agent_abort', { requestId }).catch(() => undefined);
    }
    this.inFlightByThread.clear();
  }
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

async function assembleRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const repos = await getRepos();
  for (const required of ['threads', 'chatThreads', 'projects'] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start Pi Agent runtime: repos.${required} is unavailable.`);
    }
  }
  return new DesktopPiAgentRuntime(companyId, repos);
}

export function getDesktopAgentRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const cached = runtimeCache.get(companyId);
  if (cached) return cached;
  const promise = assembleRuntime(companyId).catch((err) => {
    runtimeCache.delete(companyId);
    throw err;
  });
  runtimeCache.set(companyId, promise);
  return promise;
}

export async function disposeDesktopAgentRuntime(companyId: string): Promise<void> {
  const cached = runtimeCache.get(companyId);
  if (!cached) return;
  runtimeCache.delete(companyId);
  try {
    const runtime = await cached;
    await runtime.dispose();
  } catch (err) {
    console.warn('[desktop-agent-runtime] dispose failed', { companyId, err });
  }
}
