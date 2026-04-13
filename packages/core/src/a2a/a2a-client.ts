/**
 * A2AClient — HTTP JSON-RPC client for the A2A Protocol v0.3.0.
 *
 * Sends tasks to external A2A-compatible agents.
 * Supports both blocking (wait for response) and non-blocking (poll) modes.
 *
 * Usage:
 *   const client = new A2AClient({ name: 'Remote Agent', url: 'http://...', token: '...' });
 *   const card = await client.getAgentCard();
 *   const task = await client.sendBlocking('Summarize this document');
 */

import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type {
  A2AAgentCard,
  A2AJsonRpcResponse,
  A2APeer,
  A2ATask,
  A2ATaskState,
} from './a2a-types.js';

const logger = new Logger('a2a-client');

/** Terminal task states — no further polling needed. */
const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set(['completed', 'failed', 'canceled']);

export class A2AClient {
  private readonly peer: A2APeer;
  private readonly endpoint: string;
  private readonly cardUrl: string;

  constructor(peer: A2APeer) {
    this.peer = peer;
    const base = peer.url.replace(/\/$/, '');
    this.endpoint = `${base}/a2a/jsonrpc`;
    this.cardUrl = `${base}/.well-known/agent-card.json`;
  }

  // --- Public API -----------------------------------------------------------

  /** Discover peer's capabilities via its Agent Card. */
  async getAgentCard(): Promise<A2AAgentCard> {
    logger.info('Fetching agent card', { url: this.cardUrl });
    const res = await fetch(this.cardUrl, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Agent card fetch failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as A2AAgentCard;
  }

  /** Send a message and wait for the response (blocking mode). */
  async sendBlocking(message: string, agentId?: string): Promise<A2ATask> {
    return this.sendMessage(message, true, agentId);
  }

  /** Send a message without waiting for completion (non-blocking mode). */
  async sendNonBlocking(message: string, agentId?: string): Promise<A2ATask> {
    return this.sendMessage(message, false, agentId);
  }

  /** Shared implementation for blocking and non-blocking message send. */
  private async sendMessage(
    message: string,
    blocking: boolean,
    agentId?: string,
  ): Promise<A2ATask> {
    const targetAgent = agentId ?? this.peer.agentId;
    logger.info('Sending message', { peer: this.peer.name, blocking, agentId: targetAgent });
    return this.rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ type: 'text', text: message }],
        ...(targetAgent ? { agentId: targetAgent } : {}),
      },
      configuration: { blocking },
    });
  }

  /** Poll for the status of a previously submitted task. */
  async getTask(taskId: string): Promise<A2ATask> {
    return this.rpc('tasks/get', { id: taskId });
  }

  /**
   * Send a message and poll until the task reaches a terminal state.
   *
   * Unlike `sendBlocking` (which relies on the remote server holding the
   * connection open), this method submits non-blocking and actively polls,
   * making it more resilient to servers that don't support blocking mode.
   */
  async sendAndWait(
    message: string,
    opts?: {
      agentId?: string;
      /** Maximum time to wait in ms (default: 120 000). */
      timeoutMs?: number;
      /** Polling interval in ms (default: 2 000). */
      pollMs?: number;
    },
  ): Promise<A2ATask> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const pollInterval = opts?.pollMs ?? 2_000;

    const task = await this.sendNonBlocking(message, opts?.agentId);

    // If the server already returned a terminal state, we're done.
    if (TERMINAL_STATES.has(task.status.state)) {
      return task;
    }

    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval));
      const updated = await this.getTask(task.id);

      if (TERMINAL_STATES.has(updated.status.state)) {
        return updated;
      }

      logger.debug('Task still in progress', { taskId: task.id, state: updated.status.state });
    }

    throw new Error(
      `A2A task ${task.id} timed out after ${timeout}ms (last state: ${task.status.state})`,
    );
  }

  // --- Internal: JSON-RPC transport ------------------------------------------

  private async rpc(method: string, params: Record<string, unknown>): Promise<A2ATask> {
    const requestId = generateId('a2a-req');

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method,
        params,
      }),
    });

    if (!res.ok) {
      throw new Error(`A2A RPC failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as A2AJsonRpcResponse;

    if (body.error) {
      throw new Error(`A2A error ${body.error.code}: ${body.error.message}`);
    }

    if (!body.result) {
      throw new Error('A2A response missing result');
    }

    return body.result;
  }

  private authHeaders(): Record<string, string> {
    if (!this.peer.token) return {};
    return { Authorization: `Bearer ${this.peer.token}` };
  }
}
