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
import { type ForkSubContextResult, forkSubContext } from './fork-sub-context.js';

const logger = new Logger('a2a-client');

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export const A2A_AGENT_CARD_MAX_BYTES = 20 * 1024;
export const A2A_RPC_MAX_BYTES = 1_000_000;
export const A2A_FETCH_TIMEOUT_MS = 10_000;

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
      const card = JSON.parse(await readResponseTextWithLimit(res, A2A_AGENT_CARD_MAX_BYTES)) as
        | A2AAgentCard
        | null;
      if (!card || typeof card !== 'object') {
        throw new Error('Agent card response was not a JSON object');
      }
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

  private async rpc<R>(method: string, params: Record<string, unknown>): Promise<R> {
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
      const body = JSON.parse(await readResponseTextWithLimit(res, A2A_RPC_MAX_BYTES)) as
        A2AJsonRpcResponse<R>;
      if (body.error) {
        throw new Error(`A2A error ${body.error.code}: ${body.error.message}`);
      }
      if (body.result === undefined) {
        throw new Error(`A2A response missing result for ${method}`);
      }
      return body.result;
    });
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
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new Error(`A2A response exceeds ${maxBytes} bytes`);
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('a2a response too large');
        throw new Error(`A2A response exceeds ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

async function withA2AFetchTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), A2A_FETCH_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function assertSameOrigin(url: URL, expected: URL, label: string): void {
  if (url.origin !== expected.origin) {
    throw new Error(`${label} must stay on the configured A2A peer origin`);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.startsWith('::ffff:')) {
    const mapped = parseIpv4(host.slice('::ffff:'.length));
    if (mapped) return isPrivateOrLocalHost(mapped.join('.'));
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return Number.NaN;
    return Number(part);
  });
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets as [number, number, number, number];
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
