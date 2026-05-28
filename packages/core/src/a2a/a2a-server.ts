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

export class A2ARequestHandler {
  constructor(
    private readonly config: A2AServerConfig,
    private readonly onTaskReceived: A2ATaskHandler,
  ) {}

  async handle(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    // Agent Card discovery (unauthenticated — public well-known).
    if (req.method === 'GET' && req.path.includes('.well-known/agent-card')) {
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(this.config.agentCard),
      };
    }

    // JSON-RPC endpoint. v1.0 spec default path is `/rpc`; we match any POST
    // whose path resolves to the JSONRPC interface URL (typically ends in /rpc
    // or /a2a/rpc, configured by the agent card's supportedInterfaces entry).
    if (req.method === 'POST') {
      return this.handleJsonRpc(req);
    }

    return { status: 404, headers: {}, body: 'Not found' };
  }

  private async handleJsonRpc(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    const authHeader = req.headers.authorization ?? req.headers.Authorization ?? '';
    if (authHeader !== `Bearer ${this.config.token}`) {
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
    if (req.body && req.body.length > MAX_BODY_BYTES) {
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
      return {
        status: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
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
