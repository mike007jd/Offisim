/**
 * Live enhance transport (PR-06) — the renderer → Tauri → Pi enhance bridge.
 *
 * Calls the dedicated, isolated `agent_runtime_enhance` command (no project
 * workspace, no tools, no persistence). The authoritative enhanced text is the
 * command's return value; the Channel's content deltas are forwarded to an
 * optional `onDelta` so the review dialog can show a live, cancelable preview.
 *
 * This is the ONLY enhance file that touches Tauri. The service + contract +
 * span layers stay transport-agnostic so the harness drives them with a fake.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../../runtime/pi-runtime-driver.js';
import { readPiModelOverride } from '../../runtime/pi-agent-config.js';
import { resolveThreadThinkingOverride } from '../../runtime/pi-thread-thinking-store.js';
import type { EnhanceTransport, EnhanceTransportResult } from './service.js';

function newRequestId(): string {
  return `enhance-${crypto.randomUUID()}`;
}

/**
 * Build a Tauri-backed enhance transport. `threadId` (optional) lets enhance honor
 * the conversation's model + thinking overrides — purely cosmetic for enhance,
 * which has no scope of its own, but keeps the picked model consistent with the
 * thread. `onDelta` receives streamed content for a live preview.
 */
export function createTauriEnhanceTransport(opts?: {
  threadId?: string;
  onDelta?: (delta: string) => void;
}): EnhanceTransport {
  return {
    async run({ profile, request, signal }): Promise<EnhanceTransportResult> {
      const requestId = newRequestId();
      const onEvent = new Channel<PiAgentHostEvent>();
      let streamed = '';
      onEvent.onmessage = (event) => {
        if (event.kind === 'messageDelta' && event.delta && event.channel !== 'reasoning') {
          streamed += event.delta;
          opts?.onDelta?.(event.delta);
        }
      };

      // Cancel through the SAME in-flight abort path execute uses; enhance shares
      // the request-id keyed IN_FLIGHT registry on the Rust side.
      const onAbort = () => {
        void invoke('agent_runtime_abort', { requestId }).catch(() => undefined);
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        const response = (await invoke('agent_runtime_enhance', {
          req: {
            requestId,
            text: request.text,
            // The versioned profile system instruction is the host's system prompt.
            systemPrompt: profile.systemPrompt,
            model: readPiModelOverride() || undefined,
            thinkingLevel: opts?.threadId
              ? resolveThreadThinkingOverride(opts.threadId)
              : undefined,
          },
          onEvent,
        })) as PiAgentHostResponse;
        const text = response.text || streamed;
        return { text };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
