/**
 * Live enhance transport — the renderer → engine gateway enhance bridge.
 *
 * Calls the selected engine's dedicated, isolated Enhance command (no project
 * workspace, no tools, no transcript persistence). The authoritative enhanced
 * text is the command's return value; the Channel's content deltas are forwarded
 * to an optional `onDelta` so the review dialog can show a live, cancelable preview.
 *
 * This is the ONLY enhance file that touches Tauri. The service + contract +
 * span layers stay transport-agnostic so the harness drives them with a fake.
 */

import { invokeCommand } from '@/lib/tauri-commands.js';
import {
  isSameExecutionTarget,
  parseRuntimeExecutionSelector,
  resolveRuntimeExecutionSelection,
} from '@/runtime/desktop-agent-runtime.js';
import {
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
} from '@/runtime/execution-provenance.js';
import type { TurnExecutionProvenance } from '@/runtime/execution-provenance.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import { resolveThreadThinkingOverride } from '@/runtime/pi-thread-thinking-store.js';
import { getRepos } from '@/runtime/repos.js';
import {
  assertThreadExecutionLane,
  planThreadExecutionSelection,
  resolveAuthoritativeThreadExecutionAuthority,
} from '@/runtime/thread-execution-authority.js';
import { Channel } from '@tauri-apps/api/core';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../../runtime/pi-runtime-driver.js';
import {
  EnhanceCancelledError,
  type EnhanceTransport,
  type EnhanceTransportResult,
} from './service.js';

function newRequestId(): string {
  return `enhance-${crypto.randomUUID()}`;
}

type EnhanceEngineId = 'api' | 'codex' | 'claude';

function requireEnhanceEngine(engineId: string): EnhanceEngineId {
  if (engineId === 'api' || engineId === 'codex' || engineId === 'claude') return engineId;
  throw new Error(`AI engine ${engineId} does not support Prompt Enhance.`);
}

function abortEnhance(engineId: EnhanceEngineId, requestId: string): Promise<void> {
  if (engineId === 'codex') return invokeCommand('codex_agent_abort', { requestId });
  if (engineId === 'claude') return invokeCommand('claude_agent_abort', { requestId });
  return invokeCommand('agent_runtime_abort', { requestId });
}

async function resolveThreadEnhanceTarget(threadId: string) {
  const repos = await getRepos();
  const thread = await repos.chatThreads.findById(threadId);
  if (!thread) return undefined;
  const project = await repos.projects.findById(thread.project_id);
  if (!project) return undefined;
  return resolveAuthoritativeThreadExecutionAuthority(
    await repos.agentRuns.findByThread(threadId),
    project.company_id,
  );
}

/**
 * Build a Tauri-backed enhance transport. `threadId` (optional) lets Enhance use
 * that task's durable lane, explicit exact-model selection, and thinking level.
 * A no-thread Loop Enhance chooses the first verified stable model from the live
 * catalog. Expiring models are never selected implicitly. `onDelta` receives live
 * preview text.
 */
export function createTauriEnhanceTransport(opts?: {
  threadId?: string;
  onDelta?: (delta: string) => void;
}): EnhanceTransport {
  return {
    async run({ profile, request, signal }): Promise<EnhanceTransportResult> {
      const requestId = newRequestId();
      let engineId: EnhanceEngineId | undefined;
      let requestClaimed = false;
      let abortRequested = signal?.aborted ?? false;
      const abortClaimedEnhance = (): void => {
        if (!requestClaimed || !engineId) return;
        void abortEnhance(engineId, requestId).catch(() => undefined);
      };
      const onAbort = (): void => {
        abortRequested = true;
        abortClaimedEnhance();
      };
      const throwIfAborted = (): void => {
        if (abortRequested || signal?.aborted) throw new EnhanceCancelledError();
      };
      if (signal && !signal.aborted) signal.addEventListener('abort', onAbort, { once: true });

      try {
        throwIfAborted();
        const requestedModel = opts?.threadId ? resolveThreadModel(opts.threadId) : undefined;
        const durableAuthority = opts?.threadId
          ? await resolveThreadEnhanceTarget(opts.threadId)
          : undefined;
        throwIfAborted();
        const selectionPlan = planThreadExecutionSelection(
          durableAuthority,
          requestedModel || undefined,
          undefined,
        );
        const selection = selectionPlan.requiresCatalog
          ? resolveRuntimeExecutionSelection(
              await invokeCommand('agent_runtime_status', { includeUsage: false }),
              parseRuntimeExecutionSelector(selectionPlan.requestedModel),
              selectionPlan.frozenAuthority?.target,
              selectionPlan.frozenAuthority?.runtimeModelRef,
            )
          : selectionPlan.frozenAuthority;
        throwIfAborted();
        if (!selection) throw new Error('Prompt Enhance has no executable AI binding.');
        if (selectionPlan.authoritativeAuthority) {
          assertThreadExecutionLane(selectionPlan.authoritativeAuthority.target, selection.target);
        }
        const selectedEngineId = requireEnhanceEngine(selection.target.engineId);
        engineId = selectedEngineId;
        const sourceProvenance = requireTurnExecutionProvenance(
          { ...selection.target, runId: requestId, runtimeModelRef: selection.runtimeModelRef },
          requestId,
        );
        const onEvent = new Channel<PiAgentHostEvent>();
        let streamed = '';
        let channelError: Error | null = null;
        const preparations = new Map<
          string,
          { digest: string; identity: TurnExecutionProvenance; promise: Promise<void> }
        >();
        onEvent.onmessage = (event) => {
          if (event.kind === 'messageDelta' && event.delta && event.channel !== 'reasoning') {
            streamed += event.delta;
            opts?.onDelta?.(event.delta);
          }
          if (event.kind !== 'executionPrepared') return;
          let identity: TurnExecutionProvenance;
          try {
            identity = requireTurnExecutionProvenance(event.identity, requestId);
            assertSameExecutionAccount(sourceProvenance, identity);
            if (!isSameExecutionTarget(selection.target, identity)) {
              throw new Error('Enhance tried to execute a different account or exact model.');
            }
            if (
              !identity.adapter ||
              identity.adapter.id !== event.adapter.id ||
              identity.adapter.version !== event.adapter.version
            ) {
              throw new Error('Enhance adapter identity changed during preparation.');
            }
          } catch (error) {
            channelError = error instanceof Error ? error : new Error(String(error));
            abortClaimedEnhance();
            return;
          }
          const existing = preparations.get(event.prepareId);
          if (existing) {
            if (existing.digest !== event.targetDigest) {
              channelError = new Error('Enhance execution receipt changed during preparation.');
              abortClaimedEnhance();
            } else {
              try {
                assertSameExecutionAccount(existing.identity, identity);
              } catch (error) {
                channelError = error instanceof Error ? error : new Error(String(error));
                abortClaimedEnhance();
              }
            }
            return;
          }
          const promise = (async (): Promise<void> => {
            if (!event.prepareId.trim() || !event.targetDigest.trim()) {
              throw new Error('Enhance returned an invalid execution preparation receipt.');
            }
            // Native CLI adapters validate their canonical orchestration target
            // internally. Only the API lane needs the provider-side ACK.
            if (selectedEngineId === 'codex' || selectedEngineId === 'claude') return;
            await invokeCommand('agent_runtime_confirm_execution', {
              requestId,
              prepareId: event.prepareId,
              targetDigest: event.targetDigest,
            });
          })();
          preparations.set(event.prepareId, { digest: event.targetDigest, identity, promise });
          void promise.catch((error: unknown) => {
            channelError = error instanceof Error ? error : new Error(String(error));
            abortClaimedEnhance();
          });
        };

        throwIfAborted();
        requestClaimed = true;
        const nativeArgs = {
          req: {
            requestId,
            text: request.text,
            expectedTarget: selection.target,
            systemPrompt: profile.systemPrompt,
            sourceProvenance,
          },
          onEvent,
        };
        const apiArgs = {
          req: {
            requestId,
            text: request.text,
            // The versioned profile system instruction is the host's system prompt.
            systemPrompt: profile.systemPrompt,
            model: selection.runtimeModelRef,
            expectedTarget: selection.target,
            runtimeModelRef: selection.runtimeModelRef,
            thinkingLevel: opts?.threadId
              ? resolveThreadThinkingOverride(opts.threadId)
              : undefined,
            sourceProvenance,
          },
          onEvent,
        };
        const response = (await (selectedEngineId === 'codex'
          ? invokeCommand('codex_agent_enhance', nativeArgs)
          : selectedEngineId === 'claude'
            ? invokeCommand('claude_agent_enhance', nativeArgs)
            : invokeCommand('agent_runtime_enhance', apiArgs))) as PiAgentHostResponse;
        requestClaimed = false;
        throwIfAborted();
        if (preparations.size === 0) {
          throw new Error('Enhance did not prepare an exact AI execution target.');
        }
        await Promise.all([...preparations.values()].map((entry) => entry.promise));
        if (channelError) throw channelError;
        const provenance = requireTurnExecutionProvenance(response.provenance, requestId);
        assertSameExecutionAccount(sourceProvenance, provenance);
        const preparedIdentity = [...preparations.values()].find(
          (entry) => entry.identity.runId === requestId,
        )?.identity;
        if (!preparedIdentity) {
          throw new Error('Enhance returned a result without a prepared adapter identity.');
        }
        assertSameExecutionAccount(preparedIdentity, provenance);
        const text = response.text || streamed;
        return { text };
      } finally {
        requestClaimed = false;
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
