/**
 * A2AClient — HTTP JSON-RPC client for the A2A Protocol v1.0.
 *
 * Flow:
 *   1. Discover peer via GET {peer.url}/.well-known/agent-card.json
 *   2. Resolve the JSONRPC endpoint from agentCard.supportedInterfaces[].url
 *   3. Invoke SendMessage / GetTask / CancelTask / SubscribeToTask / ListTasks
 *
 * Spec: https://a2a-protocol.org/latest/specification
 *
 * Usage:
 *   const client = new A2AClient({ name: 'Remote Agent', url: 'http://peer', token: '...' });
 *   const card = await client.getAgentCard();
 *   const task = await client.sendAndWait('Summarize this document');
 */

import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type {
  A2AAgentCard,
  A2AJsonRpcResponse,
  A2AMessage,
  A2APeer,
  A2ASendMessageResult,
  A2ATask,
  A2ATaskState,
} from './a2a-types.js';

const logger = new Logger('a2a-client');

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export class A2AClient {
  private readonly peer: A2APeer;
  private readonly cardUrl: string;
  private cachedCard: A2AAgentCard | null = null;
  private cachedEndpoint: string | null = null;

  constructor(peer: A2APeer) {
    this.peer = peer;
    const base = peer.url.replace(/\/$/, '');
    this.cardUrl = `${base}/.well-known/agent-card.json`;
  }

  // --- Public API -----------------------------------------------------------

  /** Discover peer's capabilities via its v1.0 Agent Card. */
  async getAgentCard(force = false): Promise<A2AAgentCard> {
    if (this.cachedCard && !force) return this.cachedCard;
    logger.info('Fetching agent card', { url: this.cardUrl });
    const res = await fetch(this.cardUrl, { headers: this.authHeaders() });
    if (!res.ok) {
      throw new Error(`Agent card fetch failed: ${res.status} ${res.statusText}`);
    }
    const card = (await res.json()) as A2AAgentCard;
    this.cachedCard = card;
    this.cachedEndpoint = null;
    return card;
  }

  /**
   * Send a single message. Returns a one-of { task, message } result per v1.0
   * SendMessage semantics. Most agents return a task; some return a direct
   * message reply for trivial prompts.
   */
  async sendMessage(
    message: string,
    opts?: { agentId?: string; contextId?: string; taskId?: string },
  ): Promise<A2ASendMessageResult> {
    const targetAgent = opts?.agentId ?? this.peer.agentId;
    const envelope: A2AMessage = {
      messageId: generateId('a2a-msg'),
      role: 'user',
      parts: [{ text: message }],
      ...(opts?.contextId ? { contextId: opts.contextId } : {}),
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      ...(targetAgent ? { agentId: targetAgent } : {}),
    };
    logger.info('SendMessage', { peer: this.peer.name, agentId: targetAgent });
    return this.rpc<A2ASendMessageResult>('SendMessage', { message: envelope });
  }

  /** Poll for the status of a previously submitted task. */
  async getTask(taskId: string, historyLength?: number): Promise<A2ATask> {
    const params: Record<string, unknown> = { id: taskId };
    if (historyLength !== undefined) params.historyLength = historyLength;
    return this.rpc<A2ATask>('GetTask', params);
  }

  /** Cancel an in-flight task. */
  async cancelTask(taskId: string): Promise<A2ATask> {
    return this.rpc<A2ATask>('CancelTask', { id: taskId });
  }

  /**
   * Send a message and poll GetTask until the task reaches a terminal state.
   *
   * If SendMessage returns a message-only reply (no task), the reply is wrapped
   * in a synthetic completed task so callers can handle both shapes uniformly.
   */
  async sendAndWait(
    message: string,
    opts?: {
      agentId?: string;
      contextId?: string;
      /** Maximum time to wait in ms (default: 120 000). */
      timeoutMs?: number;
      /** Polling interval in ms (default: 2 000). */
      pollMs?: number;
    },
  ): Promise<A2ATask> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const pollInterval = opts?.pollMs ?? 2_000;

    const result = await this.sendMessage(message, {
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      ...(opts?.contextId ? { contextId: opts.contextId } : {}),
    });

    if (result.task) {
      if (TERMINAL_STATES.has(result.task.status.state)) return result.task;
      return this.pollUntilTerminal(result.task, timeout, pollInterval);
    }
    if (result.message) {
      return {
        id: generateId('a2a-task'),
        status: {
          state: 'TASK_STATE_COMPLETED',
          message: result.message,
        },
      };
    }
    throw new Error('A2A SendMessage returned neither task nor message');
  }

  private async pollUntilTerminal(
    initial: A2ATask,
    timeoutMs: number,
    pollMs: number,
  ): Promise<A2ATask> {
    const deadline = Date.now() + timeoutMs;
    let last = initial;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      last = await this.getTask(initial.id);
      if (TERMINAL_STATES.has(last.status.state)) return last;
      logger.debug('Task still in progress', { taskId: initial.id, state: last.status.state });
    }
    throw new Error(
      `A2A task ${initial.id} timed out after ${timeoutMs}ms (last state: ${last.status.state})`,
    );
  }

  // --- Internal: endpoint resolution + JSON-RPC transport --------------------

  private async resolveEndpoint(): Promise<string> {
    if (this.cachedEndpoint) return this.cachedEndpoint;
    const card = await this.getAgentCard();
    const jsonRpc = card.supportedInterfaces?.find((iface) => iface.protocolBinding === 'JSONRPC');
    const chosen = jsonRpc ?? card.supportedInterfaces?.[0];
    if (!chosen) {
      throw new Error(
        `A2A peer ${this.peer.name} agent card has no supportedInterfaces — cannot resolve RPC endpoint`,
      );
    }
    if (chosen.protocolBinding !== 'JSONRPC') {
      throw new Error(
        `A2A peer ${this.peer.name} only exposes ${chosen.protocolBinding}; this client requires JSONRPC`,
      );
    }
    this.cachedEndpoint = chosen.url;
    return chosen.url;
  }

  private async rpc<R>(method: string, params: Record<string, unknown>): Promise<R> {
    const endpoint = await this.resolveEndpoint();
    const requestId = generateId('a2a-req');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    });
    if (!res.ok) {
      throw new Error(`A2A RPC ${method} failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as A2AJsonRpcResponse<R>;
    if (body.error) {
      throw new Error(`A2A error ${body.error.code}: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new Error(`A2A response missing result for ${method}`);
    }
    return body.result;
  }

  private authHeaders(): Record<string, string> {
    if (!this.peer.token) return {};
    return { Authorization: `Bearer ${this.peer.token}` };
  }
}
