/**
 * Live enhance transport — the renderer → engine gateway enhance bridge.
 *
 * Calls the dedicated, isolated `agent_runtime_enhance` command (no project
 * workspace, no tools, no transcript persistence). The authoritative enhanced text is the
 * command's return value; the Channel's content deltas are forwarded to an
 * optional `onDelta` so the review dialog can show a live, cancelable preview.
 *
 * This is the ONLY enhance file that touches Tauri. The service + contract +
 * span layers stay transport-agnostic so the harness drives them with a fake.
 */

import { invokeCommand } from '@/lib/tauri-commands.js';
import {
  isSameExecutionTarget,
  resolveApiExecutionSelection,
} from '@/runtime/desktop-agent-runtime.js';
import {
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
} from '@/runtime/execution-provenance.js';
import type { TurnExecutionProvenance } from '@/runtime/execution-provenance.js';
import { resolveThreadModel } from '@/runtime/pi-thread-model-store.js';
import { resolveThreadThinkingOverride } from '@/runtime/pi-thread-thinking-store.js';
import { Channel } from '@tauri-apps/api/core';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../../runtime/pi-runtime-driver.js';
import type { EnhanceTransport, EnhanceTransportResult } from './service.js';

function newRequestId(): string {
  return `enhance-${crypto.randomUUID()}`;
}

/**
 * Build a Tauri-backed enhance transport. `threadId` (optional) lets Enhance use
 * that task's explicit exact-model selection and thinking level. With no explicit
 * selection, the gateway chooses the first verified stable model; expiring models
 * are never selected implicitly. `onDelta` receives live preview text.
 */
export function createTauriEnhanceTransport(opts?: {
  threadId?: string;
  onDelta?: (delta: string) => void;
}): EnhanceTransport {
  return {
    async run({ profile, request, signal }): Promise<EnhanceTransportResult> {
      const requestId = newRequestId();
      const runtimeStatus = await invokeCommand('agent_runtime_status');
      const requestedModel = opts?.threadId ? resolveThreadModel(opts.threadId) : undefined;
      const selection = resolveApiExecutionSelection(
        runtimeStatus,
        requestedModel || undefined,
        undefined,
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
          assertSameExecutionAccount({ ...selection.target, runId: requestId }, identity);
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
          void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
          return;
        }
        const existing = preparations.get(event.prepareId);
        if (existing) {
          if (existing.digest !== event.targetDigest) {
            channelError = new Error('Enhance execution receipt changed during preparation.');
            void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
          } else {
            try {
              assertSameExecutionAccount(existing.identity, identity);
            } catch (error) {
              channelError = error instanceof Error ? error : new Error(String(error));
              void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
            }
          }
          return;
        }
        const promise = (async () => {
          if (!event.prepareId.trim() || !event.targetDigest.trim()) {
            throw new Error('Enhance returned an invalid execution preparation receipt.');
          }
          await invokeCommand('agent_runtime_confirm_execution', {
            requestId,
            prepareId: event.prepareId,
            targetDigest: event.targetDigest,
          });
        })();
        preparations.set(event.prepareId, { digest: event.targetDigest, identity, promise });
        void promise.catch((error: unknown) => {
          channelError = error instanceof Error ? error : new Error(String(error));
          void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
        });
      };

      // Cancel through the SAME in-flight abort path execute uses; enhance shares
      // the request-id keyed IN_FLIGHT registry on the Rust side.
      const onAbort = () => {
        void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        const response = (await invokeCommand('agent_runtime_enhance', {
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
          },
          onEvent,
        })) as PiAgentHostResponse;
        if (preparations.size === 0) {
          throw new Error('Enhance did not prepare an exact AI execution target.');
        }
        await Promise.all([...preparations.values()].map((entry) => entry.promise));
        if (channelError) throw channelError;
        const provenance = requireTurnExecutionProvenance(response.provenance, requestId);
        assertSameExecutionAccount({ ...selection.target, runId: requestId }, provenance);
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
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
