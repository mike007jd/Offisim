// Collaboration runtime transport — the ONLY place the collaboration controller
// touches the Pi host (PR-03). It invokes the dedicated `agent_runtime_collaborate`
// Tauri command (NOT `agent_runtime_execute`), so a collaboration reply can never
// take the work path: no project bind, no agent_runs / mission persistence, no
// Office dramaturgy projection. The host enforces zero tools / no workspace; this
// transport only streams the reply deltas and returns the final text + usage.
//
// Shaped as an injectable interface so the turn controller is testable with a fake
// transport (no live model) and the production transport is the only Tauri-bound
// piece.

import type { AgentRunUsage } from '@offisim/shared-types';
import { Channel, invoke } from '@tauri-apps/api/core';
import { readPiModelOverride } from '../pi-agent-config.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../pi-runtime-driver.js';

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
  thinkingLevel?: string;
}

export interface CollaborationTurnResult {
  text: string;
  reasoning?: string;
  usage?: AgentRunUsage;
}

/**
 * Drives ONE speaker turn. `onDelta` streams content deltas for a live preview;
 * `signal` aborts the in-flight host run (mapping to `agent_runtime_abort` with
 * the same request id, exactly like the enhance transport).
 */
export interface CollaborationTransport {
  run(
    req: CollaborationTurnRequest,
    opts?: { onDelta?: (delta: string) => void; signal?: AbortSignal },
  ): Promise<CollaborationTurnResult>;
}

/** The production transport: invokes the isolated `agent_runtime_collaborate`
 *  gateway command and consumes the streaming Channel. */
export function createTauriCollaborationTransport(): CollaborationTransport {
  return {
    async run(req, opts) {
      const onEvent = new Channel<PiAgentHostEvent>();
      let streamed = '';
      let reasoning = '';
      onEvent.onmessage = (event) => {
        if (event.kind === 'messageDelta' && event.delta) {
          if (event.channel === 'reasoning') {
            reasoning += event.delta;
          } else {
            streamed += event.delta;
            opts?.onDelta?.(event.delta);
          }
        }
      };

      const onAbort = () => {
        void invoke('agent_runtime_abort', { requestId: req.requestId }).catch(() => undefined);
      };
      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        const response = (await invoke('agent_runtime_collaborate', {
          req: {
            requestId: req.requestId,
            // The frozen capability enum the host routes on. Always 'collaboration'
            // from this transport — the host has its own `mode:'collaborate'`
            // dispatch, but forwarding the enum keeps the wire contract explicit.
            capabilityProfile: 'collaboration',
            text: req.text,
            companyId: req.companyId,
            collaborationThreadId: req.collaborationThreadId,
            employeeId: req.employeeId,
            model: req.model?.trim() || readPiModelOverride() || undefined,
            thinkingLevel: req.thinkingLevel?.trim() || undefined,
            systemPromptAppend: req.systemPromptAppend?.trim() || undefined,
          },
          onEvent,
        })) as PiAgentHostResponse;
        const text = response.text || streamed;
        const finalReasoning = (response.reasoning || reasoning).trim();
        return {
          text,
          ...(finalReasoning ? { reasoning: finalReasoning } : {}),
          ...(response.usage ? { usage: response.usage } : {}),
        };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
