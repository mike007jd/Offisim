/**
 * A2A (Agent-to-Agent) Protocol v0.3.0 — Type definitions.
 *
 * Transport: HTTP, JSON-RPC 2.0
 * Discovery: GET /.well-known/agent-card.json
 * RPC endpoint: POST /a2a/jsonrpc
 *
 * This is the PREFERRED communication method between Offisim employees and
 * external OpenClaw lobster agents. The WebSocket-based OpenClaw Gateway
 * Protocol (see ../gateway/) remains available for real-time event streaming
 * but A2A is the standard cross-agent interop layer.
 */

// ---------------------------------------------------------------------------
// Peer configuration
// ---------------------------------------------------------------------------

/** A remote A2A-compatible agent endpoint. */
export interface A2APeer {
  /** Human-readable name for this peer. */
  name: string;
  /** Base URL of the peer's A2A endpoint, e.g. http://100.101.169.105:18800 */
  url: string;
  /** Bearer token for authenticating with this peer. */
  token: string;
  /** Default agent ID to target on this peer (optional). */
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Message parts
// ---------------------------------------------------------------------------

export interface A2ATextPart {
  type: 'text';
  text: string;
}

export interface A2AFilePart {
  type: 'file';
  name?: string;
  mimeType?: string;
  /** URI reference to the file. */
  uri?: string;
  /** Base64-encoded file content. */
  data?: string;
}

export interface A2ADataPart {
  type: 'data';
  mimeType?: string;
  data: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

// ---------------------------------------------------------------------------
// Messages & tasks
// ---------------------------------------------------------------------------

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  /** Target a specific agent on the peer (optional). */
  agentId?: string;
}

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
}

export interface A2AArtifact {
  name?: string;
  parts: A2APart[];
}

export interface A2ATask {
  id: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
}

// ---------------------------------------------------------------------------
// Agent card (discovery)
// ---------------------------------------------------------------------------

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  skills: A2ASkill[];
  auth: { type: 'bearer' };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface A2AConfig {
  /** Port for Offisim's own A2A server. */
  serverPort: number;
  /** Token that incoming A2A requests must provide. */
  serverToken: string;
  /** Connected peers (OpenClaw instances, other Offisim instances, etc.). */
  peers: A2APeer[];
}

// ---------------------------------------------------------------------------
// JSON-RPC wire types (internal)
// ---------------------------------------------------------------------------

export interface A2AJsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface A2AJsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: A2ATask;
  error?: { code: number; message: string; data?: unknown };
}
