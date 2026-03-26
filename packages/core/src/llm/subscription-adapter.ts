/**
 * SubscriptionAdapter — LLM Gateway adapter for subscription-based access.
 *
 * Routes LLM requests through a local ACP (Agent Client Protocol) server
 * that speaks to the user's existing AI subscription (Claude Pro/Max, Codex, etc.).
 *
 * Wire protocol: JSON-RPC 2.0 over stdio (ndjson).
 * Methods: initialize → session/new → session/prompt → session/update notifications.
 *
 * This adapter implements the same LlmGateway interface as the API-based adapters,
 * making it transparent to the rest of the system.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { LlmError } from '../errors.js';
import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ToolCallResult,
} from './gateway.js';

// ── ACP JSON-RPC types ──────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

// ── AsyncMutex ──────────────────────────────────────────────────────

class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── Adapter ─────────────────────────────────────────────────────────

export interface SubscriptionAdapterOptions {
  /** ACP server command (default: 'claude'). */
  command?: string;
  /** Extra arguments passed to the ACP server command. */
  args?: string[];
  /** Working directory for the ACP session. */
  cwd?: string;
  /** Environment variables for the child process. */
  env?: Record<string, string>;
}

export class SubscriptionAdapter implements LlmGateway {
  private process: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly pending = new Map<
    number,
    {
      resolve: (msg: JsonRpcResponse) => void;
      reject: (err: Error) => void;
    }
  >();
  private readonly notificationListeners: ((n: JsonRpcNotification) => void)[] = [];
  private readonly promptMutex = new AsyncMutex();

  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string>;

  constructor(opts: SubscriptionAdapterOptions = {}) {
    this.command = opts.command ?? 'claude';
    this.args = opts.args ?? ['acp'];
    this.cwd = opts.cwd ?? process.cwd();
    this.env = opts.env ?? {};
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  private async ensureReady(): Promise<void> {
    if (this.initialized && this.sessionId && this.process) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.startup();
    await this.initPromise;
  }

  private async startup(): Promise<void> {
    const proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = proc;

    if (!proc.stdout) {
      throw new LlmError('ACP process stdout unavailable', 'subscription');
    }

    const rl = createInterface({ input: proc.stdout });
    this.rl = rl;
    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if ('id' in msg && typeof msg.id === 'number') {
          // Response to a request
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            pending.resolve(msg as JsonRpcResponse);
          }
        } else if ('method' in msg) {
          // Notification
          for (const listener of this.notificationListeners) {
            listener(msg as JsonRpcNotification);
          }
        }
      } catch {
        // Skip unparseable lines (stderr leaking into stdout, etc.)
      }
    });

    proc.on('error', (err) => {
      // Reject all pending requests
      for (const [, p] of this.pending) {
        p.reject(new LlmError(`ACP process error: ${err.message}`, 'subscription'));
      }
      this.pending.clear();
    });

    proc.on('exit', (code) => {
      this.initialized = false;
      this.sessionId = null;
      this.process = null;
      this.initPromise = null;
      for (const [, p] of this.pending) {
        p.reject(new LlmError(`ACP process exited with code ${code}`, 'subscription'));
      }
      this.pending.clear();
    });

    const initResult = await this.rpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'offisim', title: 'Offisim Runtime', version: '1.0.0' },
    });

    if (!initResult.result) {
      throw new LlmError(
        `ACP initialize failed: ${JSON.stringify(initResult.error)}`,
        'subscription',
      );
    }

    const sessionResult = await this.rpc('session/new', {
      cwd: this.cwd,
      mcpServers: [],
    });

    if (!sessionResult.result?.sessionId) {
      throw new LlmError(
        `ACP session/new failed: ${JSON.stringify(sessionResult.error)}`,
        'subscription',
      );
    }

    this.sessionId = sessionResult.result.sessionId as string;
    this.initialized = true;
  }

  // ── JSON-RPC transport ──────────────────────────────────────────

  private rpc(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new LlmError('ACP process not running', 'subscription'));
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new LlmError(`ACP request ${method} timed out`, 'subscription'));
      }, 120_000);

      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process?.stdin?.write(`${JSON.stringify(request)}\n`);
    });
  }

  // ── LlmGateway implementation ──────────────────────────────────

  async chat(request: LlmRequest): Promise<LlmResponse> {
    await this.ensureReady();

    // Build ACP prompt from LlmMessages
    const promptText = this.buildPromptText(request);

    const chunks: string[] = [];
    const toolCalls: ToolCallResult[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const listener = (n: JsonRpcNotification) => {
      if (n.method !== 'session/update') return;
      const parsed = this.parseNotification(n.params);
      if (parsed.text) chunks.push(parsed.text);
      if (parsed.toolCall) toolCalls.push(parsed.toolCall);
      if (parsed.usage) {
        inputTokens = parsed.usage.inputTokens ?? inputTokens;
        outputTokens = parsed.usage.outputTokens ?? outputTokens;
      }
    };

    await this.promptMutex.acquire();
    try {
      this.notificationListeners.push(listener);
      try {
        const result = await this.rpc('session/prompt', {
          sessionId: this.sessionId,
          prompt: [{ type: 'text', text: promptText }],
        });

        if (result.error) {
          throw new LlmError(`ACP prompt failed: ${result.error.message}`, 'subscription');
        }

        const resultContent = this.extractContent(result.result ?? {});
        const content = resultContent || chunks.join('');

        return {
          content,
          toolCalls,
          usage: { inputTokens, outputTokens },
        };
      } finally {
        const idx = this.notificationListeners.indexOf(listener);
        if (idx >= 0) this.notificationListeners.splice(idx, 1);
      }
    } finally {
      this.promptMutex.release();
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    await this.ensureReady();

    const promptText = this.buildPromptText(request);

    // Set up a queue for streaming chunks
    const queue: LlmStreamChunk[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    const listener = (n: JsonRpcNotification) => {
      if (n.method !== 'session/update') return;
      const parsed = this.parseNotification(n.params);
      if (parsed.text) {
        queue.push({ content: parsed.text, done: false });
        resolveWait?.();
      }
      if (parsed.toolCall) {
        queue.push({ toolCalls: [parsed.toolCall], done: false });
        resolveWait?.();
      }
    };

    await this.promptMutex.acquire();
    this.notificationListeners.push(listener);

    // Send prompt (don't await — we stream notifications while it processes)
    const rpcPromise = this.rpc('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: promptText }],
    })
      .then((result) => {
        // Final chunk
        const content = this.extractContent(result.result ?? {});
        if (content) {
          queue.push({ content, done: false });
        }

        const usage = result.result?.usage as
          | { inputTokens?: number; outputTokens?: number }
          | undefined;
        queue.push({
          done: true,
          usage: usage
            ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
            : undefined,
        });
        done = true;
        resolveWait?.();
      })
      .catch((err) => {
        queue.push({
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          done: true,
        });
        done = true;
        resolveWait?.();
      });

    try {
      while (true) {
        if (queue.length > 0) {
          const chunk = queue.shift();
          if (!chunk) {
            continue;
          }
          yield chunk;
          if (chunk.done) break;
        } else if (done) {
          break;
        } else {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
          resolveWait = null;
        }
      }
    } finally {
      const idx = this.notificationListeners.indexOf(listener);
      if (idx >= 0) this.notificationListeners.splice(idx, 1);
      this.promptMutex.release();
      await rpcPromise.catch(() => {}); // ensure cleanup
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Parse a session/update notification into structured parts. */
  private parseNotification(params: Record<string, unknown>): {
    text?: string;
    toolCall?: ToolCallResult;
    usage?: { inputTokens?: number; outputTokens?: number };
  } {
    const result: ReturnType<SubscriptionAdapter['parseNotification']> = {};
    if (params.type === 'agent_message' || params.type === 'text') {
      const text = (params.content as string) ?? (params.text as string) ?? '';
      if (text) result.text = text;
    }
    if (params.type === 'tool_call' && params.name) {
      result.toolCall = {
        id: (params.toolCallId as string) ?? `tc-${Date.now()}`,
        name: params.name as string,
        arguments: (params.input as Record<string, unknown>) ?? {},
      };
    }
    if (params.usage) {
      result.usage = params.usage as { inputTokens?: number; outputTokens?: number };
    }
    return result;
  }

  /** Convert LlmRequest messages into a single text prompt for ACP. */
  private buildPromptText(request: LlmRequest): string {
    const parts: string[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        parts.push(`[System]\n${msg.content}`);
      } else if (msg.role === 'user') {
        parts.push(msg.content);
      } else if (msg.role === 'assistant') {
        parts.push(`[Assistant]\n${msg.content}`);
      } else if (msg.role === 'tool') {
        parts.push(`[Tool Result ${msg.toolCallId ?? ''}]\n${msg.content}`);
      }
    }

    // Add model/temperature hints if available
    if (request.model) {
      parts.unshift(`[Model: ${request.model}]`);
    }

    return parts.join('\n\n');
  }

  /** Extract text content from an ACP response result. */
  private extractContent(result: Record<string, unknown>): string {
    // ACP response may have content blocks or direct text
    if (typeof result.content === 'string') return result.content;
    if (Array.isArray(result.content)) {
      return result.content
        .filter(
          (b: unknown) =>
            typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text',
        )
        .map((b: unknown) => ((b as Record<string, unknown>).text as string) ?? '')
        .join('');
    }
    if (typeof result.text === 'string') return result.text;
    return '';
  }

  /** Kill the ACP server process and clean up all resources. */
  dispose(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.initialized = false;
    this.sessionId = null;
    this.initPromise = null;
    this.pending.clear();
    this.notificationListeners.length = 0;
  }
}
