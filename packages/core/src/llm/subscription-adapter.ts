/**
 * SubscriptionAdapter — LLM Gateway adapter for subscription-based access.
 *
 * Routes LLM requests through a local ACP (Agent Client Protocol) server
 * that speaks to the user's existing AI subscription (Claude Pro/Max, Codex, etc.).
 *
 * Uses the official @agentclientprotocol/sdk for transport, handshake, and streaming.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { LlmError, toErrorMessage } from '../errors.js';
import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
  ToolCallResult,
} from './gateway.js';

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
  private connection: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  /** Set by the active chat/chatStream call. Requires promptLock serialization. */
  private activeChunkHandler: ((n: SessionNotification) => void) | null = null;
  private promptLock: Promise<void> = Promise.resolve();
  private disposed = false;

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

  private async ensureReady(): Promise<void> {
    if (this.sessionId && this.connection) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.startup();
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  private async startup(): Promise<void> {
    const proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = proc;

    if (!proc.stdin || !proc.stdout) {
      proc.kill();
      this.process = null;
      throw new LlmError('ACP process stdio unavailable', 'subscription');
    }

    const output = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(output, input);

    this.connection = new ClientSideConnection((): Client => ({
      requestPermission: async (params) => {
        const firstAllow = params.options.find((o) => o.optionId !== 'deny');
        const optionId = firstAllow?.optionId ?? params.options[0]?.optionId ?? 'allow';
        return { outcome: { outcome: 'selected', optionId } };
      },
      sessionUpdate: async (params) => {
        this.activeChunkHandler?.(params);
      },
    }), stream);

    proc.on('exit', () => {
      this.sessionId = null;
      this.connection = null;
      this.initPromise = null;
      this.process = null;
    });

    try {
      await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'offisim', version: '1.0.0' },
      });
    } catch (err) {
      this.killAndReset();
      throw new LlmError(`ACP initialize failed: ${toErrorMessage(err)}`, 'subscription');
    }

    try {
      const session = await this.connection.newSession({
        cwd: this.cwd,
        mcpServers: [],
      });
      this.sessionId = session.sessionId;
    } catch (err) {
      this.killAndReset();
      throw new LlmError(`ACP session/new failed: ${toErrorMessage(err)}`, 'subscription');
    }
  }

  /** Acquire the prompt lock. Caller MUST call the returned release function. */
  private async acquireLock(): Promise<() => void> {
    if (this.disposed) throw new LlmError('Adapter disposed', 'subscription');
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const prev = this.promptLock;
    this.promptLock = gate;
    await prev;
    return release!;
  }

  private requireConnection(): { connection: ClientSideConnection; sessionId: string } {
    if (!this.connection || !this.sessionId) {
      throw new LlmError('ACP connection lost', 'subscription');
    }
    return { connection: this.connection, sessionId: this.sessionId };
  }

  private installCancelHandler(
    signal: AbortSignal | undefined,
    connection: ClientSideConnection,
    sessionId: string,
  ): (() => void) | undefined {
    if (!signal) return undefined;
    const handler = () => {
      connection.cancel({ sessionId }).catch(() => {});
    };
    signal.addEventListener('abort', handler, { once: true });
    return handler;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const release = await this.acquireLock();
    try {
      await this.ensureReady();
      const { connection, sessionId } = this.requireConnection();
      const promptText = this.buildPromptText(request);
      const chunks: string[] = [];
      const toolCalls: ToolCallResult[] = [];

      this.activeChunkHandler = (n) => {
        const { text, toolCall } = this.parseUpdate(n);
        if (text) chunks.push(text);
        if (toolCall) toolCalls.push(toolCall);
      };

      const cancelHandler = this.installCancelHandler(request.signal, connection, sessionId);
      try {
        const result = await connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text: promptText }],
        });

        const usage = result.usage;
        return {
          content: chunks.join(''),
          toolCalls,
          usage: {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          },
        };
      } catch (err) {
        throw new LlmError(`ACP prompt failed: ${toErrorMessage(err)}`, 'subscription');
      } finally {
        this.activeChunkHandler = null;
        if (request.signal && cancelHandler) {
          request.signal.removeEventListener('abort', cancelHandler);
        }
      }
    } finally {
      release();
    }
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const release = await this.acquireLock();

    await this.ensureReady();
    const { connection, sessionId } = this.requireConnection();
    const promptText = this.buildPromptText(request);

    // Async queue bridges callback-based SDK → AsyncIterable.
    const queue: LlmStreamChunk[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    let streamError: Error | null = null;

    this.activeChunkHandler = (n) => {
      const { text, toolCall } = this.parseUpdate(n);
      if (text) {
        queue.push({ content: text, done: false });
        resolveWait?.();
      }
      if (toolCall) {
        queue.push({ toolCalls: [toolCall], done: false });
        resolveWait?.();
      }
    };

    const cancelHandler = this.installCancelHandler(request.signal, connection, sessionId);

    // Don't await — yield chunks as they arrive via sessionUpdate callback.
    const rpcPromise = connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    })
      .then((result) => {
        const usage = result.usage;
        queue.push({
          done: true,
          usage: usage
            ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
            : undefined,
        });
        done = true;
        resolveWait?.();
      })
      .catch((err) => {
        streamError = new LlmError(`ACP prompt failed: ${toErrorMessage(err)}`, 'subscription');
        done = true;
        resolveWait?.();
      });

    try {
      while (true) {
        if (queue.length > 0) {
          const chunk = queue.shift()!;
          yield chunk;
          if (chunk.done) break;
        } else if (done) {
          if (streamError) throw streamError;
          break;
        } else {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
          resolveWait = null;
        }
      }
    } finally {
      this.activeChunkHandler = null;
      if (request.signal && cancelHandler) {
        request.signal.removeEventListener('abort', cancelHandler);
      }
      // Wait for RPC to settle but cap at 5s to avoid blocking the lock forever.
      await Promise.race([
        rpcPromise.catch(() => {}),
        new Promise<void>((r) => setTimeout(r, 5_000)),
      ]);
      release();
    }
  }

  private parseUpdate(n: SessionNotification): {
    text?: string;
    toolCall?: ToolCallResult;
  } {
    const update = n.update;

    if (update.sessionUpdate === 'agent_message_chunk') {
      const block = update.content;
      if (block.type === 'text') {
        return { text: block.text };
      }
    }

    if (update.sessionUpdate === 'tool_call') {
      return {
        toolCall: {
          id: update.toolCallId ?? `tc-${Date.now()}`,
          name: update.title ?? 'unknown',
          arguments: {},
        },
      };
    }

    return {};
  }

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

    if (request.model) {
      parts.unshift(`[Model: ${request.model}]`);
    }

    return parts.join('\n\n');
  }

  /** Reset all connection state and kill the child process. */
  private killAndReset(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connection = null;
    this.sessionId = null;
    this.initPromise = null;
  }

  dispose(): void {
    this.disposed = true;
    this.killAndReset();
    this.activeChunkHandler = null;
    // Resolve the lock so any queued callers unblock and see the disposed flag.
    this.promptLock = Promise.resolve();
  }
}
