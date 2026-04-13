/**
 * A2ARequestHandler — HTTP request handler for the A2A Protocol v0.3.0 (server side).
 *
 * Lets external A2A-compatible agents send tasks TO Offisim employees.
 *
 * This handler is transport-agnostic: it processes a normalized request object
 * and returns a normalized response object. It can be mounted on:
 *   - Tauri's Rust-side HTTP server
 *   - A standalone Node.js HTTP server (development)
 *   - Any framework's middleware layer
 *
 * Usage:
 *   const handler = new A2ARequestHandler(
 *     { token: 'secret', agentCard: { ... } },
 *     async (message, agentId) => {
 *       // route to an Offisim employee and return the response
 *       return 'Task completed successfully';
 *     },
 *   );
 *   const res = await handler.handle({ method: 'POST', path: '/a2a/jsonrpc', ... });
 */

import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type { A2AAgentCard, A2AJsonRpcRequest, A2APart, A2ATask } from './a2a-types.js';

const logger = new Logger('a2a-server');

// ---------------------------------------------------------------------------
// Normalized HTTP interface (transport-agnostic)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Handler configuration
// ---------------------------------------------------------------------------

export interface A2AServerConfig {
  /** Bearer token that incoming requests must provide. */
  token: string;
  /** This Offisim instance's agent card. */
  agentCard: A2AAgentCard;
}

/**
 * Callback invoked when an external agent sends a task to Offisim.
 *
 * @param message - The extracted text content from the incoming message parts.
 * @param agentId - Optional target agent/employee ID specified by the caller.
 * @returns The response text to send back.
 */
export type A2ATaskHandler = (message: string, agentId?: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export class A2ARequestHandler {
  constructor(
    private readonly config: A2AServerConfig,
    private readonly onTaskReceived: A2ATaskHandler,
  ) {}

  /** Handle an incoming HTTP request and return the response. */
  async handle(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    // --- Agent Card discovery ---
    if (req.method === 'GET' && req.path.includes('.well-known/agent-card')) {
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(this.config.agentCard),
      };
    }

    // --- JSON-RPC endpoint ---
    if (req.method === 'POST' && req.path.includes('/a2a/jsonrpc')) {
      return this.handleJsonRpc(req);
    }

    return { status: 404, headers: {}, body: 'Not found' };
  }

  // --- Internal: JSON-RPC dispatch -------------------------------------------

  private async handleJsonRpc(req: A2AHttpRequest): Promise<A2AHttpResponse> {
    // Auth check — look up the authorization header case-insensitively without copying all headers
    const authHeader = req.headers.authorization ?? req.headers.Authorization ?? '';
    if (authHeader !== `Bearer ${this.config.token}`) {
      logger.warn('Unauthorized A2A request');
      // Return HTTP 200 with JSON-RPC error to stay compliant with JSON-RPC 2.0 spec
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

    // Body size guard — reject payloads larger than 1 MB to avoid memory abuse
    const MAX_BODY_BYTES = 1_048_576; // 1 MB
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

    // Parse JSON-RPC body
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
      case 'message/send':
        return this.handleMessageSend(rpc);
      case 'tasks/get':
        return this.handleTasksGet(rpc);
      default:
        return this.jsonRpcError(rpc.id, -32601, `Unknown method: ${rpc.method}`);
    }
  }

  private async handleMessageSend(rpc: A2AJsonRpcRequest): Promise<A2AHttpResponse> {
    const params = rpc.params as Record<string, unknown>;
    const message = params.message as { parts?: A2APart[]; agentId?: string } | undefined;
    const parts = message?.parts ?? [];
    const agentId = message?.agentId as string | undefined;

    // Extract text from all text parts
    const text = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n');

    if (!text) {
      return this.jsonRpcError(rpc.id, -32602, 'No text content in message');
    }

    const taskId = generateId('a2a-task');
    logger.info('Received A2A task', { taskId, agentId, textLength: text.length });

    try {
      const response = await this.onTaskReceived(text, agentId);
      const task: A2ATask = {
        id: taskId,
        status: { state: 'completed' },
        artifacts: [{ parts: [{ type: 'text', text: response }] }],
      };

      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: task }),
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('A2A task execution failed', err, { taskId });

      const failedTask: A2ATask = {
        id: taskId,
        status: {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: errorMessage }],
          },
        },
      };

      return {
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: failedTask }),
      };
    }
  }

  private handleTasksGet(rpc: A2AJsonRpcRequest): Promise<A2AHttpResponse> {
    // Current implementation is synchronous (blocking mode only).
    // tasks/get for async task tracking will be implemented when we add
    // non-blocking server-side execution with persistent task storage.
    const taskId = (rpc.params as Record<string, unknown>).id as string;
    return Promise.resolve(
      this.jsonRpcError(rpc.id, -32001, `Task polling not yet implemented (task: ${taskId})`),
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
