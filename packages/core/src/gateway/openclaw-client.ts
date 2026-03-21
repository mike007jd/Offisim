/**
 * OpenClawClient — WebSocket client for the OpenClaw Gateway Protocol v3.
 *
 * Lifecycle:
 *  1. connect() opens WebSocket
 *  2. Waits for connect.challenge event from gateway
 *  3. Sends connect request (token + deviceId + protocol negotiation)
 *  4. Waits for hello-ok response
 *  5. Enters 'connected' state; starts ping heartbeat
 *  6. Auto-reconnects on unexpected disconnects (exponential backoff, max 5 retries)
 *
 * Emits:
 *  - 'stateChanged'  (state: ConnectionState)
 *  - 'agentEvent'    ({ agentId: string; type: string; data: unknown })
 *  - 'chatEvent'     ({ sessionKey: string; type: string; content: unknown })
 *  - 'error'         (Error)
 */

import { Logger } from '../services/logger.js';
import type {
  ConnectionState,
  EventFrame,
  OpenClawAgent,
  OpenClawChatResponse,
  OpenClawConfig,
  RequestFrame,
  ResponseFrame,
  WireFrame,
} from './openclaw-types.js';

const DEVICE_ID_KEY = 'aics.openclaw.deviceId';
const REQUEST_TIMEOUT_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 30_000];
const MAX_RECONNECT_ATTEMPTS = 5;

const logger = new Logger('openclaw-client');

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type ClientEventMap = {
  stateChanged: [state: ConnectionState];
  agentEvent: [event: { agentId: string; type: string; data: unknown }];
  chatEvent: [event: { sessionKey: string; type: string; content: unknown }];
  error: [error: Error];
};

type Listener<K extends keyof ClientEventMap> = (...args: ClientEventMap[K]) => void;

/**
 * Minimal typed event emitter — avoids the Node.js `events` module so this
 * module stays safe in both Tauri webview and browser bundles.
 */
class TypedEmitter {
  // biome-ignore lint/suspicious/noExplicitAny: listener map must accept heterogeneous handler types
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  on<K extends keyof ClientEventMap>(event: K, listener: Listener<K>): this {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return this;
  }

  off<K extends keyof ClientEventMap>(event: K, listener: Listener<K>): this {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((h) => h !== listener));
    return this;
  }

  protected emit<K extends keyof ClientEventMap>(event: K, ...args: ClientEventMap[K]): void {
    const list = this.handlers.get(event) ?? [];
    for (const h of list) {
      try {
        h(...args);
      } catch (err) {
        logger.error(`Unhandled error in '${event}' listener`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------

export class OpenClawClient extends TypedEmitter {
  private ws: WebSocket | null = null;
  private readonly config: OpenClawConfig;
  private readonly deviceId: string;
  private state: ConnectionState = 'disconnected';
  private requestCounter = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  /** Resolve/reject for the in-progress connect() promise */
  private connectResolve: (() => void) | null = null;
  private connectReject: ((e: Error) => void) | null = null;

  constructor(config: OpenClawConfig) {
    super();
    this.config = config;
    this.deviceId = config.deviceId ?? this.resolveDeviceId();
  }

  // --- Public API -----------------------------------------------------------

  /**
   * Connect to the OpenClaw Gateway.
   * Resolves when the handshake completes ('connected' state).
   * Rejects if the handshake fails or times out.
   */
  async connect(): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'error') {
      logger.warn('connect() called in non-idle state', { state: this.state });
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.openSocket();
    });
  }

  /** Close the WebSocket and stop auto-reconnect. */
  disconnect(): void {
    this.reconnectAttempt = MAX_RECONNECT_ATTEMPTS; // suppress reconnects
    this.clearReconnectTimer();
    this.teardownSocket(1000, 'client disconnect');
    this.setState('disconnected');
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    const res = await this.rpc('agents.list', {});
    return (res.agents as OpenClawAgent[] | undefined) ?? [];
  }

  async sendChat(sessionKey: string, message: string): Promise<OpenClawChatResponse> {
    const res = await this.rpc('chat.send', { sessionKey, message });
    return res as unknown as OpenClawChatResponse;
  }

  async getChatHistory(sessionKey: string): Promise<Record<string, unknown>[]> {
    const res = await this.rpc('chat.history', { sessionKey });
    return (res.messages as Record<string, unknown>[] | undefined) ?? [];
  }

  async abortChat(sessionKey: string): Promise<void> {
    await this.rpc('chat.abort', { sessionKey });
  }

  async getToolsCatalog(agentId?: string): Promise<Record<string, unknown>[]> {
    const params = agentId ? { agentId } : {};
    const res = await this.rpc('tools.catalog', params);
    return (res.tools as Record<string, unknown>[] | undefined) ?? [];
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  // --- Internal: socket lifecycle -------------------------------------------

  private openSocket(): void {
    this.setState('connecting');
    try {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;

      ws.onopen = () => {
        // Protocol v3: wait for connect.challenge event before sending auth
        this.setState('authenticating');
        logger.debug('WebSocket open — awaiting connect.challenge');
      };

      ws.onmessage = (ev) => {
        this.handleMessage(ev.data as string);
      };

      ws.onerror = (ev) => {
        const msg = (ev as ErrorEvent).message ?? 'WebSocket error';
        logger.error('WebSocket error', msg);
        this.emit('error', new Error(msg));
      };

      ws.onclose = (ev) => {
        this.handleClose(ev.code, ev.reason);
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('Failed to open WebSocket', error, { url: this.config.url });
      this.handleConnectFailure(error);
    }
  }

  private teardownSocket(code = 1000, reason = ''): void {
    this.stopPing();
    this.rejectAllPending(new Error(`Connection closed: ${reason}`));
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close(code, reason);
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private handleClose(code: number, reason: string): void {
    logger.info('WebSocket closed', { code, reason });
    this.teardownSocket();

    const isNormal = code === 1000 || code === 1001;
    if (this.connectReject) {
      // Handshake was in progress — treat as failure
      this.handleConnectFailure(new Error(`Connection closed during handshake (${code})`));
      return;
    }

    if (isNormal || this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.setState('disconnected');
      return;
    }

    this.scheduleReconnect();
  }

  // --- Internal: handshake --------------------------------------------------

  private handleConnectChallenge(): void {
    // Localhost connections with a token — send token in auth, no nonce signing required
    const frame: RequestFrame = {
      type: 'req',
      id: this.nextRequestId(),
      method: 'connect',
      params: {
        auth: {
          token: this.config.token,
        },
        deviceId: this.deviceId,
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        minProtocol: 3,
        maxProtocol: 3,
      },
    };
    this.sendFrame(frame);
    logger.debug('Sent connect request');
  }

  private handleHelloOk(): void {
    this.reconnectAttempt = 0;
    this.setState('connected');
    this.startPing();

    const resolve = this.connectResolve;
    this.connectResolve = null;
    this.connectReject = null;
    resolve?.();
    logger.info('Connected to OpenClaw Gateway', { deviceId: this.deviceId, url: this.config.url });
  }

  private handleConnectFailure(error: Error): void {
    this.setState('error');
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    reject?.(error);
    this.emit('error', error);
  }

  // --- Internal: message parsing --------------------------------------------

  private handleMessage(raw: string): void {
    let frame: WireFrame;
    try {
      frame = JSON.parse(raw) as WireFrame;
    } catch (err) {
      logger.warn('Received non-JSON WebSocket message', { raw: raw.slice(0, 200) });
      return;
    }

    switch (frame.type) {
      case 'event':
        this.handleEventFrame(frame);
        break;
      case 'res':
        this.handleResponseFrame(frame);
        break;
      case 'req':
        // Gateway should not be sending req frames to the client in v3
        logger.warn('Received unexpected req frame from gateway', { method: frame.method });
        break;
      default:
        logger.warn('Received unknown frame type', { frame });
    }
  }

  private handleEventFrame(frame: EventFrame): void {
    const { event, payload = {} } = frame;

    // Handshake events
    if (event === 'connect.challenge') {
      this.handleConnectChallenge();
      return;
    }
    if (event === 'hello-ok') {
      // Some gateway versions send hello-ok as an event rather than a res frame
      this.handleHelloOk();
      return;
    }

    // Agent events: agent.<agentId>.<eventType>
    if (event.startsWith('agent.')) {
      const parts = event.split('.');
      if (parts.length >= 3) {
        const agentId = parts[1] ?? '';
        const type = parts.slice(2).join('.');
        this.emit('agentEvent', { agentId, type, data: payload });
        return;
      }
    }

    // Chat events: chat.<sessionKey>.<eventType>
    if (event.startsWith('chat.')) {
      const parts = event.split('.');
      if (parts.length >= 3) {
        const sessionKey = parts[1] ?? '';
        const type = parts.slice(2).join('.');
        this.emit('chatEvent', { sessionKey, type, content: payload });
        return;
      }
    }

    logger.debug('Unhandled gateway event', { event, payload });
  }

  private handleResponseFrame(frame: ResponseFrame): void {
    // Special case: hello-ok sent as a res frame
    if ((frame.payload as Record<string, unknown> | undefined)?.['hello'] === 'ok') {
      this.handleHelloOk();
      // Also resolve any pending request for the connect req id
      this.resolvePending(frame.id, frame);
      return;
    }

    this.resolvePending(frame.id, frame);
  }

  private resolvePending(id: string, frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);

    if (frame.ok) {
      pending.resolve(frame.payload ?? {});
    } else {
      const err = frame.error;
      pending.reject(
        new Error(err ? `${err.code}: ${err.message}` : 'RPC call failed with no error detail'),
      );
    }
  }

  // --- Internal: RPC --------------------------------------------------------

  private async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.isConnected()) {
      throw new Error(`Cannot call '${method}': not connected (state=${this.state})`);
    }

    const id = this.nextRequestId();
    const frame: RequestFrame = { type: 'req', id, method, params };

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method} (${REQUEST_TIMEOUT_MS}ms)`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.sendFrame(frame);
    });
  }

  private sendFrame(frame: WireFrame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Attempted to send frame on non-open socket', { frameType: frame.type });
      return;
    }
    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      logger.error('Failed to send frame', err, { frameType: frame.type });
    }
  }

  // --- Internal: heartbeat --------------------------------------------------

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        // fire-and-forget; ignore errors — connection health is monitored via close events
        this.rpc('ping', {}).catch(() => {});
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // --- Internal: reconnect --------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('Max reconnect attempts reached — giving up');
      this.setState('error');
      return;
    }

    const delayMs = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;

    logger.info('Scheduling reconnect', { attempt: this.reconnectAttempt, delayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- Internal: state & utilities ------------------------------------------

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    logger.debug('State transition', { from: this.state, to: next });
    this.state = next;
    this.emit('stateChanged', next);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `req-${this.requestCounter}`;
  }

  private resolveDeviceId(): string {
    try {
      const stored = localStorage.getItem(DEVICE_ID_KEY);
      if (stored) return stored;
      const id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch {
      // localStorage unavailable (SSR / Node test env) — generate ephemeral ID
      return crypto.randomUUID();
    }
  }
}
