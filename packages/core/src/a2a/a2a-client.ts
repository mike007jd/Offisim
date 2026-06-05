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
import { isPrivateOrLocalHost } from '../utils/private-host.js';
import { readBodyWithByteLimit } from '../utils/read-body-with-limit.js';
import type {
  A2AAgentCard,
  A2AJsonRpcResponse,
  A2AMessage,
  A2APeer,
  A2ASendMessageResult,
  A2ATask,
  A2ATaskState,
} from './a2a-types.js';
import { type ForkSubContextResult, forkSubContext } from './fork-sub-context.js';

const logger = new Logger('a2a-client');

const TASK_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_FAILED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
  'TASK_STATE_UNKNOWN',
]);

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

/**
 * States where the peer is waiting on the caller rather than making progress.
 * Polling these to the timeout is wasted work — the caller must respond on the
 * same taskId — so the client hands them back as terminal-for-polling.
 */
const PAUSED_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED',
]);

export const A2A_AGENT_CARD_MAX_BYTES = 20 * 1024;
export const A2A_RPC_MAX_BYTES = 1_000_000;
export const A2A_FETCH_TIMEOUT_MS = 10_000;

/**
 * Carries the JSON-RPC `error.code` from the A2A peer so callers can
 * distinguish a "method not supported" (-32601) — which means polling will
 * never succeed — from a transient error.
 */
export class A2ARpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(`A2A error ${code}: ${message}`);
    this.name = 'A2ARpcError';
  }
}

export class A2AClient {
  private readonly peer: A2APeer;
  private readonly peerBaseUrl: URL;
  private readonly cardUrl: URL;
  private cachedCard: A2AAgentCard | null = null;
  private cachedEndpoint: URL | null = null;

  constructor(peer: A2APeer) {
    this.peer = peer;
    this.peerBaseUrl = validateA2AExternalUrl(peer.url, 'peer base URL');
    this.cardUrl = new URL('/.well-known/agent-card.json', this.peerBaseUrl);
  }

  // --- Public API -----------------------------------------------------------

  /** Discover peer's capabilities via its v1.0 Agent Card. */
  async getAgentCard(force = false): Promise<A2AAgentCard> {
    if (this.cachedCard && !force) return this.cachedCard;
    logger.info('Fetching agent card', { url: this.cardUrl.toString() });
    return withA2AFetchTimeout(async (signal) => {
      const res = await fetch(this.cardUrl, {
        headers: this.authHeaders(),
        redirect: 'manual',
        signal,
      });
      if (isRedirectStatus(res.status)) {
        throw new Error('Agent card fetch redirect was blocked');
      }
      if (!res.ok) {
        throw new Error(`Agent card fetch failed: ${res.status} ${res.statusText}`);
      }
      const parsed = JSON.parse(
        await readResponseTextWithLimit(res, A2A_AGENT_CARD_MAX_BYTES),
      ) as unknown;
      const card = assertValidAgentCard(parsed);
      assertJsonRpcInterfacesStayOnPeer(card, this.peerBaseUrl);
      this.cachedCard = card;
      this.cachedEndpoint = null;
      return card;
    });
  }

  /**
   * Send a single message. Returns a one-of { task, message } result per v1.0
   * SendMessage semantics. Most agents return a task; some return a direct
   * message reply for trivial prompts.
   */
  async sendMessage(
    message: string,
    opts?: { agentId?: string; contextId?: string; taskId?: string; signal?: AbortSignal },
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
    return this.rpc<A2ASendMessageResult>('SendMessage', { message: envelope }, opts?.signal);
  }

  /** Poll for the status of a previously submitted task. */
  async getTask(taskId: string, historyLength?: number, signal?: AbortSignal): Promise<A2ATask> {
    const params: Record<string, unknown> = { id: taskId };
    if (historyLength !== undefined) params.historyLength = historyLength;
    return assertValidTask(await this.rpc<A2ATask>('GetTask', params, signal), 'GetTask');
  }

  /** Cancel an in-flight task. */
  async cancelTask(taskId: string): Promise<A2ATask> {
    return assertValidTask(await this.rpc<A2ATask>('CancelTask', { id: taskId }), 'CancelTask');
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
      /** Existing task id to continue (multi-turn / INPUT_REQUIRED follow-up). */
      taskId?: string;
      /** Maximum time to wait in ms (default: 120 000). */
      timeoutMs?: number;
      /** Polling interval in ms (default: 2 000). */
      pollMs?: number;
      /** External cancellation signal; aborts the round-trip in addition to the per-request timeout. */
      signal?: AbortSignal;
    },
  ): Promise<A2ATask> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const pollInterval = opts?.pollMs ?? 2_000;

    const result = await this.sendMessage(message, {
      ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      ...(opts?.contextId ? { contextId: opts.contextId } : {}),
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });

    if (result.task) {
      const task = assertValidTask(result.task, 'SendMessage');
      // Terminal, or paused waiting on the caller (INPUT_REQUIRED / AUTH_REQUIRED):
      // hand it straight back so the caller can respond on the same taskId
      // instead of polling a state the peer will never advance on its own.
      if (TERMINAL_STATES.has(task.status.state) || PAUSED_STATES.has(task.status.state)) {
        return task;
      }
      return this.pollUntilTerminal(task, timeout, pollInterval, opts?.signal);
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

  async fork(peer: A2APeer, subTask: string): Promise<ForkSubContextResult> {
    const client = peer === this.peer ? this : new A2AClient(peer);
    return forkSubContext({
      subTask,
      runChild: async (childMessages) => {
        const task = await client.sendAndWait(childMessages[0]?.content ?? '', {
          ...(peer.agentId ? { agentId: peer.agentId } : {}),
        });
        return {
          summary: taskTextSummary(task),
          transcript: childMessages,
        };
      },
    });
  }

  private async pollUntilTerminal(
    initial: A2ATask,
    timeoutMs: number,
    pollMs: number,
    signal?: AbortSignal,
  ): Promise<A2ATask> {
    const deadline = Date.now() + timeoutMs;
    let last = initial;
    while (Date.now() < deadline) {
      // sleepUnlessAborted throws the same AbortError if already aborted.
      await sleepUnlessAborted(pollMs, signal);
      try {
        last = await this.getTask(initial.id, undefined, signal);
      } catch (err) {
        // -32601 (Method not found) means the peer can never satisfy GetTask;
        // any further polling is wasted time. Abort and surface a clear
        // error instead of grinding through the full timeoutMs window.
        if (err instanceof A2ARpcError && err.code === -32601) {
          throw new Error(
            `A2A peer does not support GetTask polling (task ${initial.id}; last known state: ${last.status.state})`,
          );
        }
        throw err;
      }
      if (TERMINAL_STATES.has(last.status.state) || PAUSED_STATES.has(last.status.state)) {
        return last;
      }
      logger.debug('Task still in progress', { taskId: initial.id, state: last.status.state });
    }
    throw new Error(
      `A2A task ${initial.id} timed out after ${timeoutMs}ms (last state: ${last.status.state})`,
    );
  }

  // --- Internal: endpoint resolution + JSON-RPC transport --------------------

  private async resolveEndpoint(): Promise<URL> {
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
    const endpoint = validateA2AExternalUrl(chosen.url, 'JSON-RPC endpoint');
    assertSameOrigin(endpoint, this.peerBaseUrl, 'JSON-RPC endpoint');
    this.cachedEndpoint = endpoint;
    return endpoint;
  }

  private async rpc<R>(
    method: string,
    params: Record<string, unknown>,
    external?: AbortSignal,
  ): Promise<R> {
    const endpoint = await this.resolveEndpoint();
    const requestId = generateId('a2a-req');
    return withA2AFetchTimeout(async (signal) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
        },
        redirect: 'manual',
        signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      });
      if (isRedirectStatus(res.status)) {
        throw new Error(`A2A RPC ${method} redirect was blocked`);
      }
      if (!res.ok) {
        throw new Error(`A2A RPC ${method} failed: ${res.status} ${res.statusText}`);
      }
      const body = JSON.parse(
        await readResponseTextWithLimit(res, A2A_RPC_MAX_BYTES),
      ) as A2AJsonRpcResponse<R>;
      if (body.error) {
        throw new A2ARpcError(body.error.code, body.error.message);
      }
      if (body.result === undefined) {
        throw new Error(`A2A response missing result for ${method}`);
      }
      return body.result;
    }, external);
  }

  private authHeaders(): Record<string, string> {
    if (!this.peer.token) return {};
    return { Authorization: `Bearer ${this.peer.token}` };
  }
}

export function validateA2AExternalUrl(rawUrl: string, label = 'A2A URL'): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must use https`);
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error(`${label} cannot target localhost or a private network`);
  }
  return url;
}

/**
 * Validate an agent-card payload before it is trusted downstream (its fields
 * feed `.find()`/origin checks and endpoint resolution). Require the v1.0
 * essentials — name, version, and at least one supported interface — so a
 * malformed peer surfaces a clear error instead of letting `undefined` reach
 * `.toLowerCase()`/`.find()` later.
 */
export function assertValidAgentCard(value: unknown): A2AAgentCard {
  if (!value || typeof value !== 'object') {
    throw new Error('Agent card response was not a JSON object');
  }
  const card = value as Partial<A2AAgentCard>;
  if (typeof card.name !== 'string' || card.name.length === 0) {
    throw new Error('Agent card is missing a name');
  }
  if (typeof card.version !== 'string' || card.version.length === 0) {
    throw new Error('Agent card is missing a version');
  }
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
    throw new Error('Agent card has no supportedInterfaces');
  }
  return value as A2AAgentCard;
}

/**
 * Validate a Task payload returned by the peer before its status is inspected,
 * so an unknown/missing `status.state` cannot slip through the `.has()` checks
 * (which would otherwise silently treat it as non-terminal and poll forever).
 */
export function assertValidTask(value: unknown, method: string): A2ATask {
  if (!value || typeof value !== 'object') {
    throw new Error(`A2A ${method} returned a malformed task`);
  }
  const task = value as Partial<A2ATask>;
  if (typeof task.id !== 'string' || task.id.length === 0) {
    throw new Error(`A2A ${method} task is missing an id`);
  }
  const state = task.status?.state;
  if (typeof state !== 'string' || !TASK_STATES.has(state as A2ATaskState)) {
    throw new Error(`A2A ${method} task has an unknown status.state: ${String(state)}`);
  }
  return value as A2ATask;
}

export function assertJsonRpcInterfacesStayOnPeer(card: A2AAgentCard, peerBaseUrl: URL): void {
  for (const iface of card.supportedInterfaces ?? []) {
    if (iface.protocolBinding !== 'JSONRPC') continue;
    const endpoint = validateA2AExternalUrl(iface.url, 'JSON-RPC endpoint');
    assertSameOrigin(endpoint, peerBaseUrl, 'JSON-RPC endpoint');
  }
}

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  return readBodyWithByteLimit(response, maxBytes, {
    tooLargeMessage: `A2A response exceeds ${maxBytes} bytes`,
    cancelReason: 'a2a response too large',
  });
}

async function withA2AFetchTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), A2A_FETCH_TIMEOUT_MS);
  // Combine the internal per-request timeout with any external cancellation
  // signal so the fetch aborts on whichever fires first.
  const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
  try {
    return await fn(signal);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sleep for `ms` but bail immediately if `signal` aborts, so polling between
 * requests does not ignore an in-flight cancellation.
 */
async function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    throw new DOMException('A2A task polling aborted', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('A2A task polling aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function assertSameOrigin(url: URL, expected: URL, label: string): void {
  if (url.origin !== expected.origin) {
    throw new Error(`${label} must stay on the configured A2A peer origin`);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function taskTextSummary(task: A2ATask): string {
  const texts: string[] = [];
  if (task.status.message) {
    texts.push(...messageTextParts(task.status.message));
  }
  for (const artifact of task.artifacts ?? []) {
    texts.push(
      ...artifact.parts
        .map((part) => part.text)
        .filter((text): text is string => typeof text === 'string' && text.trim().length > 0),
    );
  }
  return texts.join('\n').trim() || task.status.state;
}

function messageTextParts(message: A2AMessage): string[] {
  return message.parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0);
}
