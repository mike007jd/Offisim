/**
 * A2ARequestHandler — HTTP request handler for the A2A Protocol v1.0 (server side).
 *
 * Lets external A2A-compatible agents send tasks TO Offisim employees.
 *
 * Transport-agnostic: processes a normalized request object and returns a
 * normalized response object. Can be mounted on Tauri's Rust-side HTTP server,
 * a standalone Node server (dev), or any framework's middleware layer.
 *
 * Spec: https://a2a-protocol.org/latest/specification
 *
 * Usage:
 *   const handler = new A2ARequestHandler(
 *     { token: 'secret', agentCard: { ... } },
 *     async (message, agentId) => 'Task completed successfully',
 *   );
 *   const res = await handler.handle({ method: 'POST', path: '/rpc', ... });
 */

import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type {
  A2AAgentCard,
  A2AJsonRpcRequest,
  A2AMessage,
  A2APart,
  A2ASendMessageResult,
  A2ATask,
} from './a2a-types.js';

const logger = new Logger('a2a-server');

/**
 * Constant-time Bearer-token comparison. Both inputs are first reduced to
 * fixed-length SHA-256 digests, so neither the comparison length nor the
 * byte-by-byte loop reveals anything about the secret (no length leak, no
 * content leak). Uses Web Crypto `subtle.digest`, available in both Node and
 * the browser, keeping this handler transport-agnostic (no `node:crypto`).
 */
async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const aBytes = new Uint8Array(aDigest);
  const bBytes = new Uint8Array(bDigest);
  // Digests are always 32 bytes, so the length is constant regardless of input.
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

export interface A2AHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface A2AHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface A2AServerConfig {
  /** Bearer token that incoming RPC requests must provide. */
  token: string;
  /** This Offisim instance's v1.0 agent card (served at /.well-known/agent-card.json). */
  agentCard: A2AAgentCard;
}

/**
 * Callback invoked when an external agent sends a task to Offisim.
 *
 * @param message - Extracted text content from the incoming message parts.
 * @param agentId - Optional target agent / employee ID specified by the caller.
 * @returns The response text to send back.
 */
export type A2ATaskHandler = (message: string, agentId?: string) => Promise<string>;

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

/**
 * Normalizes a request path for exact routing: strips any query string /
 * fragment and removes a single trailing slash (except for the root `/`), so
 * `/rpc`, `/rpc/`, and `/rpc?x=1` all compare equal.
 */
function normalizePathname(rawPath: string): string {
  const path = rawPath.split('?')[0]?.split('#')[0] ?? '';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

export class A2ARequestHandler {
  constructor(
    private readonly config: A2AServerConfig,
    private readonly onTaskReceived: A2ATaskHandler,
  ) {}

  async handle(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    const path = normalizePathname(req.path);

    // Agent Card discovery (unauthenticated — public well-known). Match the
    // canonical well-known path exactly so unrelated paths that merely contain
    // the substring are not served the card.
    if (req.method === 'GET' && path === '/.well-known/agent-card.json') {
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(this.config.agentCard),
      };
    }

    // JSON-RPC endpoint. v1.0 spec default path is `/rpc`; the concrete path is
    // declared by the agent card's JSONRPC supportedInterfaces entry. Only POSTs
    // to that exact path are routed to the RPC handler; everything else is 404.
    if (req.method === 'POST' && path === this.jsonRpcPath()) {
      return this.handleJsonRpc(req);
    }

    return { status: 404, headers: {}, body: 'Not found' };
  }

  /**
   * Resolves the configured JSON-RPC interface path from the agent card's
   * JSONRPC `supportedInterfaces` entry, falling back to the v1.0 default
   * `/rpc` when the card does not declare a parseable JSONRPC URL.
   */
  private jsonRpcPath(): string {
    const iface = this.config.agentCard.supportedInterfaces.find(
      (i) => i.protocolBinding === 'JSONRPC',
    );
    if (iface) {
      try {
        return normalizePathname(new URL(iface.url).pathname);
      } catch {
        // url may be a bare path (no origin); fall through to direct normalize.
        if (iface.url.startsWith('/')) return normalizePathname(iface.url);
      }
    }
    return '/rpc';
  }

  private async handleJsonRpc(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    const authHeader = req.headers.authorization ?? req.headers.Authorization ?? '';
    if (!(await timingSafeStringEqual(authHeader, `Bearer ${this.config.token}`))) {
      logger.warn('Unauthorized A2A request');
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Unauthorized' },
        }),
      };
    }

    const MAX_BODY_BYTES = 1_048_576;
    if (req.body && new TextEncoder().encode(req.body).length > MAX_BODY_BYTES) {
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Request body too large (max 1 MB)' },
        }),
      };
    }

    let rpc: A2AJsonRpcRequest;
    try {
      rpc = JSON.parse(req.body || '{}') as A2AJsonRpcRequest;
    } catch {
      // JSON-RPC 2.0 requires a top-level `id` (null when it cannot be
      // determined). Use status 200 with the error body to match the other
      // RPC-level error branches (Unauthorized / too-large).
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }),
      };
    }

    switch (rpc.method) {
      case 'SendMessage':
        return this.handleSendMessage(rpc);
      case 'GetTask':
        return this.handleGetTask(rpc);
      case 'CancelTask':
        return this.handleCancelTask(rpc);
      case 'GetExtendedAgentCard':
        return {
          status: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: this.config.agentCard }),
        };
      default:
        return this.jsonRpcError(rpc.id, -32601, `Unknown method: ${rpc.method}`);
    }
  }

  private async handleSendMessage(rpc: A2AJsonRpcRequest): Promise<A2AHttpResponse> {
    const params = rpc.params as { message?: A2AMessage };
    const msg = params.message;
    const parts: A2APart[] = msg?.parts ?? [];
    const agentId = msg?.agentId;
    // Echo the caller's conversation context back on the returned Task so
    // context correlation works even though task persistence/polling is
    // unimplemented (see GetTask/CancelTask stubs).
    const contextId = msg?.contextId;

    const text = parts
      .map((p) => p.text)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .join('\n');

    if (!text) {
      return this.jsonRpcError(rpc.id, -32602, 'No text content in message');
    }

    const taskId = generateId('a2a-task');
    logger.info('SendMessage received', { taskId, agentId, textLength: text.length });

    try {
      const response = await this.onTaskReceived(text, agentId);
      const task: A2ATask = {
        id: taskId,
        ...(contextId ? { contextId } : {}),
        status: { state: 'TASK_STATE_COMPLETED' },
        artifacts: [
          {
            artifactId: generateId('a2a-artifact'),
            parts: [{ text: response, mediaType: 'text/plain' }],
          },
        ],
      };
      const result: A2ASendMessageResult = { task };
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('A2A task execution failed', err, { taskId });
      const failedTask: A2ATask = {
        id: taskId,
        ...(contextId ? { contextId } : {}),
        status: {
          state: 'TASK_STATE_FAILED',
          message: {
            messageId: generateId('a2a-msg'),
            role: 'agent',
            parts: [{ text: errorMessage }],
          },
        },
      };
      const result: A2ASendMessageResult = { task: failedTask };
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }),
      };
    }
  }

  private handleGetTask(rpc: A2AJsonRpcRequest): Promise<A2AHttpResponse> {
    const taskId = (rpc.params as Record<string, unknown>).id as string;
    // JSON-RPC standard code -32601 = Method not found. Distinct from -32001
    // (server-side recoverable) so that clients can recognise this as
    // structurally unsupported and abort polling immediately, instead of
    // grinding through a 2-minute poll loop.
    return Promise.resolve(
      this.jsonRpcError(rpc.id, -32601, `Task polling not implemented (task: ${taskId})`),
    );
  }

  private handleCancelTask(rpc: A2AJsonRpcRequest): Promise<A2AHttpResponse> {
    const taskId = (rpc.params as Record<string, unknown>).id as string;
    return Promise.resolve(
      this.jsonRpcError(rpc.id, -32601, `Task cancellation not implemented (task: ${taskId})`),
    );
  }

  private jsonRpcError(id: string, code: number, message: string): A2AHttpResponse {
    return {
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      }),
    };
  }
}
