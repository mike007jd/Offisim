// Collaboration runtime transport — the ONLY place the collaboration controller
// touches an engine host (PR-03). It routes every shipped engine through its
// dedicated isolated one-shot command (never a work execute command), so a collaboration
// reply cannot bind a project, persist an agent run/mission, or project Office
// dramaturgy. Each host enforces zero tools and a neutral workspace.
//
// Shaped as an injectable interface so the turn controller is testable with a fake
// transport (no live model) and the production transport is the only Tauri-bound
// piece.

import { invokeCommand } from '@/lib/tauri-commands.js';
import type {
  AgentRunUsage,
  AiExecutionTarget,
  AiRuntimeStatus,
  CollaborationProfile,
  TurnExecutionProvenance,
} from '@offisim/shared-types';
import { Channel } from '@tauri-apps/api/core';
import { resolveRuntimeExecutionSelection } from '../desktop-agent-runtime.js';
import { requireTurnExecutionProvenance } from '../execution-provenance.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../pi-runtime-driver.js';

export interface CollaborationExecutionSelection {
  target: AiExecutionTarget;
  runtimeModelRef: string;
}

function sameExecutionTarget(a: AiExecutionTarget, b: AiExecutionTarget): boolean {
  return (
    a.engineId === b.engineId &&
    a.accountId === b.accountId &&
    a.billingMode === b.billingMode &&
    a.modelId === b.modelId &&
    a.modelSource.kind === b.modelSource.kind &&
    a.modelSource.sourceUrl === b.modelSource.sourceUrl &&
    a.modelSource.checkedAt === b.modelSource.checkedAt
  );
}

type CollaborationEngineId = 'api' | 'codex' | 'claude';

function requireCollaborationEngine(engineId: string): CollaborationEngineId {
  if (engineId === 'api' || engineId === 'codex' || engineId === 'claude') return engineId;
  throw new Error(`AI engine ${engineId} does not support company chat.`);
}

/** Pure selection over the safe `agent_runtime_status` projection. */
export function selectCollaborationExecutionTarget(
  statusValue: unknown,
  requestedModel?: string,
  frozenTarget?: AiExecutionTarget,
): CollaborationExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (!Array.isArray(status.accounts) || !Array.isArray(status.models)) {
    throw new Error('AI Accounts status is unavailable for collaboration.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts.filter(
      (account) =>
        account.engineId === 'api' || account.engineId === 'codex' || account.engineId === 'claude',
    ),
    models: status.models.filter(
      (model) =>
        model.engineId === 'api' || model.engineId === 'codex' || model.engineId === 'claude',
    ),
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const selection = resolveRuntimeExecutionSelection(runtimeStatus, requestedModel, frozenTarget);
  requireCollaborationEngine(selection.target.engineId);
  return selection;
}

/** A single collaboration speaker turn the transport runs against the host. */
export interface CollaborationTurnRequest {
  /** Stable per-turn request id; also the abort handle and the turn's runtimeRequestId. */
  requestId: string;
  companyId: string;
  /** The Collaboration thread id (company-scoped daily chat) — never a project id. */
  collaborationThreadId: string;
  employeeId: string | null;
  /** The boss/user message (or round anchor) this speaker is replying to. */
  text: string;
  /** Persona + context packet, forwarded as the session's appendSystemPrompt. */
  systemPromptAppend?: string;
  model?: string;
  expectedTarget: AiExecutionTarget;
  runtimeModelRef: string;
  thinkingLevel?: string;
  collaborationProfile?: CollaborationProfile;
  mcpTools?: unknown[];
}

export interface CollaborationTurnResult {
  text: string;
  reasoning?: string;
  usage?: AgentRunUsage;
  provenance: TurnExecutionProvenance;
}

export interface CollaborationTransportRunOptions {
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** Re-read the exact turn target/request from durable storage before ACK. */
  verifyDurableTarget(identity: TurnExecutionProvenance): Promise<void>;
}

/**
 * Drives ONE speaker turn. `onDelta` streams content deltas for a live preview;
 * `signal` aborts the in-flight host run (mapping to `agent_runtime_abort` with
 * the same request id, exactly like the enhance transport).
 */
export interface CollaborationTransport {
  resolveExecutionSelection(input: {
    model?: string;
    frozenTarget?: AiExecutionTarget;
  }): Promise<CollaborationExecutionSelection>;
  run(
    req: CollaborationTurnRequest,
    opts: CollaborationTransportRunOptions,
  ): Promise<CollaborationTurnResult>;
}

export interface TauriCollaborationTransportOptions {
  onAgentRun?: (event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>) => void;
}

/** The production transport: invokes the isolated `agent_runtime_collaborate`
 *  gateway command and consumes the streaming Channel. */
export function createTauriCollaborationTransport(
  transportOptions: TauriCollaborationTransportOptions = {},
): CollaborationTransport {
  return {
    async resolveExecutionSelection(input) {
      const status = await invokeCommand('agent_runtime_status', { includeUsage: false });
      return selectCollaborationExecutionTarget(status, input.model, input.frozenTarget);
    },
    async run(req, opts) {
      const verifiedSelection = selectCollaborationExecutionTarget(
        await invokeCommand('agent_runtime_status', { includeUsage: false }),
        req.runtimeModelRef,
        req.expectedTarget,
      );
      if (
        verifiedSelection.runtimeModelRef !== req.runtimeModelRef ||
        !sameExecutionTarget(verifiedSelection.target, req.expectedTarget)
      ) {
        throw new Error('The collaboration execution selection changed before invocation.');
      }
      const engineId = requireCollaborationEngine(verifiedSelection.target.engineId);

      const abortHost = () => {
        void (
          engineId === 'codex'
            ? invokeCommand('codex_agent_abort', { requestId: req.requestId })
            : engineId === 'claude'
              ? invokeCommand('claude_agent_abort', { requestId: req.requestId })
              : invokeCommand('agent_runtime_abort', { requestId: req.requestId })
        ).catch(() => undefined);
      };
      const onEvent = new Channel<PiAgentHostEvent>();
      let streamed = '';
      let reasoning = '';
      let preparation: Promise<void> | null = null;
      let preparationError: Error | null = null;
      let preparedAdapterId = '';
      let preparedAdapterVersion = '';
      const failPreparation = (error: unknown) => {
        preparationError = error instanceof Error ? error : new Error(String(error));
        abortHost();
      };
      onEvent.onmessage = (event) => {
        if (event.kind === 'executionPrepared') {
          if (preparation) {
            failPreparation(
              new Error('Agent runtime prepared the same collaboration request twice.'),
            );
            return;
          }
          try {
            if (!event.prepareId.trim() || !event.targetDigest.trim()) {
              throw new Error('Agent runtime returned an invalid execution preparation receipt.');
            }
            const identity = requireTurnExecutionProvenance(event.identity, req.requestId);
            if (!sameExecutionTarget(identity, req.expectedTarget)) {
              throw new Error('Agent runtime prepared a different collaboration execution target.');
            }
            if (
              !identity.adapter?.id ||
              !identity.adapter.version ||
              identity.adapter.id !== event.adapter.id ||
              identity.adapter.version !== event.adapter.version
            ) {
              throw new Error('Agent runtime returned inconsistent adapter diagnostics.');
            }
            preparedAdapterId = identity.adapter.id;
            preparedAdapterVersion = identity.adapter.version;
            preparation = (async () => {
              await opts.verifyDurableTarget(identity);
              if (opts.signal?.aborted) throw new Error('Collaboration execution was stopped.');
              if (engineId === 'codex') return;
              await invokeCommand('agent_runtime_confirm_execution', {
                requestId: req.requestId,
                prepareId: event.prepareId,
                targetDigest: event.targetDigest,
              });
            })();
            void preparation.catch(failPreparation);
          } catch (error) {
            preparation = Promise.reject(error);
            void preparation.catch(failPreparation);
          }
        } else if (event.kind === 'messageDelta' && event.delta) {
          if (!preparation || preparationError) {
            failPreparation(
              new Error('Agent runtime streamed collaboration output before target confirmation.'),
            );
            return;
          }
          if (event.channel === 'reasoning') {
            reasoning += event.delta;
          } else {
            streamed += event.delta;
            opts?.onDelta?.(event.delta);
          }
        } else if (event.kind === 'agentRun') {
          transportOptions.onAgentRun?.(event);
        }
      };

      const onAbort = abortHost;
      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) {
          onAbort();
          throw new Error('Collaboration execution was stopped.');
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        if (engineId !== 'api' && req.collaborationProfile === 'collaboration_read') {
          throw new Error(
            'This subscription engine does not support the read-only company chat tool profile.',
          );
        }
        const response = (await (engineId === 'codex'
          ? invokeCommand('codex_agent_enhance', {
              req: {
                requestId: req.requestId,
                text: req.text,
                expectedTarget: req.expectedTarget,
                systemPrompt:
                  req.systemPromptAppend?.trim() ||
                  'Reply as the assigned employee in this company chat. Do not use tools or access files.',
                model: req.runtimeModelRef,
                runtimeModelRef: req.runtimeModelRef,
                thinkingLevel: req.thinkingLevel?.trim() || undefined,
              },
              onEvent,
            })
          : engineId === 'claude'
            ? invokeCommand('claude_agent_enhance', {
                req: {
                  requestId: req.requestId,
                  text: req.text,
                  expectedTarget: req.expectedTarget,
                  systemPrompt:
                    req.systemPromptAppend?.trim() ||
                    'Reply as the assigned employee in this company chat. Do not use tools or access files.',
                  model: req.runtimeModelRef,
                  runtimeModelRef: req.runtimeModelRef,
                  thinkingLevel: req.thinkingLevel?.trim() || undefined,
                },
                onEvent,
              })
            : invokeCommand('agent_runtime_collaborate', {
                req: {
                  requestId: req.requestId,
                  // The frozen capability enum the API host routes on. Always
                  // collaboration; this path never invokes the work command.
                  capabilityProfile: 'collaboration',
                  text: req.text,
                  companyId: req.companyId,
                  collaborationThreadId: req.collaborationThreadId,
                  employeeId: req.employeeId,
                  model: req.runtimeModelRef,
                  expectedTarget: req.expectedTarget,
                  runtimeModelRef: req.runtimeModelRef,
                  thinkingLevel: req.thinkingLevel?.trim() || undefined,
                  collaborationProfile: req.collaborationProfile,
                  mcpTools: req.mcpTools,
                  systemPromptAppend: req.systemPromptAppend?.trim() || undefined,
                },
                onEvent,
              }))) as PiAgentHostResponse;
        if (!preparation) {
          onAbort();
          throw new Error('Agent runtime did not prepare the collaboration execution target.');
        }
        await preparation;
        if (preparationError) throw preparationError;
        const provenance = requireTurnExecutionProvenance(response.provenance, req.requestId);
        if (!sameExecutionTarget(provenance, req.expectedTarget)) {
          throw new Error('Agent runtime returned a different collaboration execution target.');
        }
        if (
          !preparedAdapterId ||
          !preparedAdapterVersion ||
          !provenance.adapter ||
          provenance.adapter.id !== preparedAdapterId ||
          provenance.adapter.version !== preparedAdapterVersion
        ) {
          throw new Error('Agent runtime adapter identity changed after execution confirmation.');
        }
        const text = response.text || streamed;
        const finalReasoning = (response.reasoning || reasoning).trim();
        return {
          text,
          ...(finalReasoning ? { reasoning: finalReasoning } : {}),
          ...(response.usage ? { usage: response.usage } : {}),
          provenance,
        };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
