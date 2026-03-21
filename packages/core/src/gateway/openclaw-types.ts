/**
 * OpenClaw Gateway Protocol v3 — Type definitions.
 *
 * Transport: WebSocket, JSON text frames.
 * Default endpoint: ws://127.0.0.1:18789
 */

// --- Connection config ---

export interface OpenClawConfig {
  /** WebSocket URL, e.g. ws://127.0.0.1:18789 */
  url: string;
  /** Gateway token (set by the OpenClaw instance) */
  token: string;
  /**
   * Persistent device ID. Auto-generated via crypto.randomUUID() and
   * persisted to localStorage if not provided.
   */
  deviceId?: string;
}

// --- Protocol frame types ---

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: Record<string, unknown>;
}

/** Union of all wire frames */
export type WireFrame = RequestFrame | ResponseFrame | EventFrame;

// --- Domain types ---

/** Agent info from agents.list */
export interface OpenClawAgent {
  id: string;
  name: string;
  description?: string;
  model?: string;
  skills?: string[];
  status: 'online' | 'offline' | 'busy';
}

/** Chat response from chat.send */
export interface OpenClawChatResponse {
  content: string;
  model?: string;
  tokensUsed?: number;
  toolCalls?: Array<{ name: string; result: string }>;
}

// --- Connection state ---

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';
