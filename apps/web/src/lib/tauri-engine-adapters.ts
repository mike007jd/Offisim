import { DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES } from '@offisim/core/dist/engine/capability-profiles.js';
import type { EngineAdapter } from '@offisim/core/dist/engine/engine-adapter.js';
import type {
  EngineRunContext,
  EngineRunHandle,
  EngineRunResult,
  EngineTaskEnvelope,
  RuntimeActivityEvent,
} from '@offisim/core/dist/engine/engine-types.js';
import type { LlmMessage, LlmResponse } from '@offisim/core/dist/llm/gateway.js';
import type { EngineId } from '@offisim/shared-types';
import { Channel, invoke } from '@tauri-apps/api/core';

type AgentHostEvent =
  | { kind: 'result'; response: LlmResponse }
  | { kind: 'error'; code: string; message: string };

interface TauriEngineAdapterOptions {
  readonly command: 'codex_agent_execute' | 'claude_agent_execute';
  readonly abortCommand: 'codex_agent_abort' | 'claude_agent_abort';
  readonly requestPrefix: string;
  readonly baseURL?: string;
  readonly cwd?: string;
  readonly resolveProjectId?: () => Promise<string | null | undefined>;
  readonly credentialMode?: 'api-key' | 'local-auth';
}

export interface TauriEngineAdapterRegistryOptions {
  /**
   * Register the Claude / Codex sidecar engine adapters in trusted desktop
   * runtime. Default `false` so the registry can still be constructed empty
   * (e.g. for harness or stricter "verified-engine-only" modes that gate on
   * tool-execution telemetry parity, which the sidecars do not yet expose).
   *
   * When `true`, callers SHOULD surface a "preview · limited tool telemetry"
   * disclosure on UI surfaces that resolve to engine mode — the adapters work
   * for streaming text and reasoning but lack tool-started / tool-completed
   * events and engine handoff proposals.
   */
  readonly enableProviderHostPreviewAdapters?: boolean;
  readonly resolveProjectId?: () => Promise<string | null | undefined>;
}

let requestCounter = 0;

function nextRequestId(prefix: string): string {
  requestCounter = (requestCounter + 1) >>> 0;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

function normalizeInvokeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err ?? 'Unknown trusted engine error'));
}

function buildMessages(envelope: EngineTaskEnvelope): LlmMessage[] {
  const skills = envelope.requiredSkills.length > 0 ? envelope.requiredSkills.join(', ') : 'none';
  return [
    {
      role: 'system',
      content: [
        'You are a trusted runtime engine executing one Offisim-assigned employee task.',
        'Offisim owns the top-level SOP, plan, approvals, cross-employee dispatch, and knowledge truth.',
        'Do not claim to change the global plan. If you need a plan change, handoff, replan, or elevated permission, describe it as a proposal in your response.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Employee: ${envelope.employeeName} (${envelope.roleSlug})`,
        `Task type: ${envelope.taskType}`,
        `Required skills: ${skills}`,
        '',
        envelope.taskDescription,
      ].join('\n'),
    },
  ];
}

function serializeRequest(envelope: EngineTaskEnvelope): Record<string, unknown> {
  return {
    messages: buildMessages(envelope),
    model: envelope.model,
    runtimeProfileId: envelope.runtimeProfile.profileId,
    runtimeProfileTier: envelope.runtimeProfile.tier,
    temperature: 0.7,
    maxTokens: 4096,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
  };
}

async function* resultEvents(
  engineId: EngineId,
  responsePromise: Promise<LlmResponse>,
): AsyncIterable<RuntimeActivityEvent> {
  // TODO(remediation-2026-04-29): wire trusted sidecar tool_started/tool_completed
  // events to the UI once the host protocol exposes structured tool telemetry.
  yield {
    kind: 'text_delta',
    channel: 'reasoning',
    content: `${engineId} accepted the assigned task.`,
  };

  try {
    const response = await responsePromise;
    if (response.reasoningContent) {
      yield {
        kind: 'reasoning_delta',
        content: response.reasoningContent,
      };
    }
    if (response.content) {
      yield {
        kind: 'text_delta',
        channel: 'content',
        content: response.content,
      };
    }
    yield { kind: 'run_completed' };
  } catch (err) {
    yield {
      kind: 'run_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

abstract class BaseTauriEngineAdapter implements EngineAdapter {
  abstract readonly engineId: EngineId;

  constructor(private readonly options: TauriEngineAdapterOptions) {}

  async startRun(
    envelope: EngineTaskEnvelope,
    context: EngineRunContext,
  ): Promise<EngineRunHandle> {
    const requestId = nextRequestId(this.options.requestPrefix);
    const channel = new Channel<AgentHostEvent>();

    let resolveResponse!: (response: LlmResponse) => void;
    let rejectResponse!: (error: Error) => void;
    const responsePromise = new Promise<LlmResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    let settled = false;
    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectResponse(error);
    };
    const settleSuccess = (response: LlmResponse) => {
      if (settled) return;
      settled = true;
      resolveResponse(response);
    };

    channel.onmessage = (event) => {
      switch (event.kind) {
        case 'result':
          settleSuccess(event.response);
          break;
        case 'error':
          settleError(new Error(event.message || 'Trusted engine request failed.'));
          break;
      }
    };

    const signal = context.signal;
    const onAbort = () => {
      const error =
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Engine run aborted', 'AbortError');
      settleError(error);
      void this.cancelRun(requestId).catch(() => {});
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
      const resolvedProjectId = envelope.projectId ?? (await this.options.resolveProjectId?.());
      void invoke(this.options.command, {
        req: {
          requestId,
          request: serializeRequest(envelope),
          ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
          ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
          ...(this.options.credentialMode ? { credentialMode: this.options.credentialMode } : {}),
        },
        onEvent: channel,
      }).catch((err: unknown) => {
        settleError(normalizeInvokeError(err));
      });
    }

    const result = responsePromise
      .then<EngineRunResult>((response) => ({
        content: response.content,
        reasoningContent: response.reasoningContent,
        usage: response.usage,
      }))
      .finally(() => {
        signal?.removeEventListener('abort', onAbort);
      });

    return {
      runId: requestId,
      events: resultEvents(this.engineId, responsePromise),
      result,
    };
  }

  async cancelRun(runId: string): Promise<void> {
    await invoke(this.options.abortCommand, { requestId: runId });
  }
}

export class TauriCodexEngineAdapter extends BaseTauriEngineAdapter {
  readonly engineId = 'codex-engine' as const;
  readonly capabilityProfile = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.find(
    (profile) => profile.engineId === this.engineId,
  );

  constructor(
    options: Omit<TauriEngineAdapterOptions, 'command' | 'abortCommand' | 'requestPrefix'> = {},
  ) {
    super({
      ...options,
      command: 'codex_agent_execute',
      abortCommand: 'codex_agent_abort',
      requestPrefix: 'codex-engine',
    });
  }
}

export class TauriClaudeEngineAdapter extends BaseTauriEngineAdapter {
  readonly engineId = 'claude-engine' as const;
  readonly capabilityProfile = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.find(
    (profile) => profile.engineId === this.engineId,
  );

  constructor(
    options: Omit<TauriEngineAdapterOptions, 'command' | 'abortCommand' | 'requestPrefix'> = {},
  ) {
    super({
      ...options,
      command: 'claude_agent_execute',
      abortCommand: 'claude_agent_abort',
      requestPrefix: 'claude-engine',
    });
  }
}

export function createTauriEngineAdapterRegistry(
  options: TauriEngineAdapterRegistryOptions = {},
): Map<EngineId, EngineAdapter> {
  if (!options.enableProviderHostPreviewAdapters) {
    return new Map<EngineId, EngineAdapter>();
  }

  return new Map<EngineId, EngineAdapter>([
    ['codex-engine', new TauriCodexEngineAdapter({ resolveProjectId: options.resolveProjectId })],
    [
      'claude-engine',
      new TauriClaudeEngineAdapter({
        credentialMode: 'local-auth',
        resolveProjectId: options.resolveProjectId,
      }),
    ],
  ]);
}
