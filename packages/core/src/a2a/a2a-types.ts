/**
 * A2A (Agent-to-Agent) Protocol v1.0 — Type definitions.
 *
 * Transport: HTTP, JSON-RPC 2.0 (default binding)
 * Discovery: GET /.well-known/agent-card.json
 * RPC endpoint: resolved from agent card `supportedInterfaces[0].url`
 *
 * Spec: https://a2a-protocol.org/latest/specification
 *
 * BREAKING differences vs Offisim's previous v0.3.0 layer:
 *   - Agent Card `url` / `preferredTransport` → `supportedInterfaces[]`
 *   - Part discriminator `type: 'text' | 'file' | 'data'` → unified `Part`
 *     with one-of `{ text, raw, url, data }` + `mediaType` + `filename`
 *   - Task state lowercase → `TASK_STATE_*` enum
 *   - JSON-RPC method names slashed → PascalCase
 *     (`message/send` → `SendMessage`, `tasks/get` → `GetTask`)
 */

// ---------------------------------------------------------------------------
// Peer configuration
// ---------------------------------------------------------------------------

/** A remote A2A-compatible agent endpoint used as an input to `A2AClient`. */
export interface A2APeer {
  /** Human-readable name for this peer. */
  name: string;
  /**
   * Base URL of the peer. Used to fetch the well-known agent card at
   * `{url}/.well-known/agent-card.json`. The actual RPC endpoint is resolved
   * from `agentCard.supportedInterfaces[0].url`.
   */
  url: string;
  /** Bearer token for authenticating with this peer (optional). */
  token?: string;
  /** Default agent ID to target on this peer (optional). */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Part — unified content container (v1.0)
// ---------------------------------------------------------------------------

/**
 * A v1.0 Part is a single unified content container. Exactly one of the
 * content fields (`text`, `raw`, `url`, `data`) is present per part.
 *
 * Consumers should branch on which field is set, not on a discriminator.
 */
export interface A2APart {
  /** Plain-text content. */
  text?: string;
  /** Base64-encoded byte content. */
  raw?: string;
  /** URL reference to externally hosted content. */
  url?: string;
  /** Structured JSON content. */
  data?: Record<string, unknown>;
  /** MIME type of the content (v1.0 uses `mediaType`, replacing v0.3 `mimeType`). */
  mediaType?: string;
  /** Optional filename (useful for file-like parts). */
  filename?: string;
  /** Optional associated metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Messages & tasks (v1.0)
// ---------------------------------------------------------------------------

export interface A2AMessage {
  /** Unique message identifier (UUID-like). Required by v1.0. */
  messageId: string;
  /** JSON-RPC binding uses the string literal; gRPC binding uses ROLE_USER/ROLE_AGENT. */
  role: 'user' | 'agent';
  parts: A2APart[];
  /** Optional context id — associates the message with a conversation context. */
  contextId?: string;
  /** Optional task id — associates the message with an existing task. */
  taskId?: string;
  /** Optional target agent id on the peer (non-standard extension used by Offisim peers). */
  agentId?: string;
  /** Optional metadata envelope. */
  metadata?: Record<string, unknown>;
  /** Extension URIs that contributed to this message. */
  extensions?: string[];
  /** Task IDs this message references for additional context. */
  referenceTaskIds?: string[];
}

/**
 * v1.0 Task state enum. JSON-RPC serialization uses the `TASK_STATE_*` form.
 */
export type A2ATaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_UNKNOWN';

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent card (v1.0 discovery)
// ---------------------------------------------------------------------------

export interface A2AAgentInterface {
  url: string;
  protocolBinding: 'JSONRPC' | 'GRPC' | 'HTTP+JSON';
  protocolVersion: string;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  extendedAgentCard?: boolean;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  /** Ordered list of supported interfaces. Index 0 is the preferred interface. */
  supportedInterfaces: A2AAgentInterface[];
  version: string;
  capabilities: A2AAgentCapabilities;
  provider?: { organization: string; url: string };
  iconUrl?: string;
  documentationUrl?: string;
  /** Named security schemes available on this agent (OIDC / OAuth2 / apiKey / …). */
  securitySchemes?: Record<string, unknown>;
  /** Security requirements: each entry is an object of `scheme-name → required scopes`. */
  security?: Array<Record<string, string[]>>;
  /** Default media types accepted as input across all skills. */
  defaultInputModes?: string[];
  /** Default media types returned as output across all skills. */
  defaultOutputModes?: string[];
  skills?: A2ASkill[];
  /** Optional JWS signatures for tamper evidence. */
  signatures?: Array<{ protected: string; signature: string }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface A2AConfig {
  /** Port for Offisim's own A2A server. */
  serverPort: number;
  /** Token that incoming A2A requests must provide. */
  serverToken: string;
  /** Connected peers (other Offisim instances, external A2A agents, etc.). */
  peers: A2APeer[];
}

// ---------------------------------------------------------------------------
// JSON-RPC wire types (internal)
// ---------------------------------------------------------------------------

/** v1.0 SendMessage result is one-of Task or Message. */
export interface A2ASendMessageResult {
  task?: A2ATask;
  message?: A2AMessage;
}

export interface A2AJsonRpcRequest<P = Record<string, unknown>> {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: P;
}

export interface A2AJsonRpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: string;
  result?: R;
  error?: { code: number; message: string; data?: unknown };
}
