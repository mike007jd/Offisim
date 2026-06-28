// Single source of truth for the Pi Agent host JSONL wire contract.
//
// The Node host (scripts/tauri-pi-agent-host.entry.mjs) builds every stdout line
// through the helpers below, the Rust bridge (apps/desktop/src-tauri/src/pi_agent_host.rs)
// decodes the same shapes, and the renderer (desktop-agent-runtime.ts) consumes them.
// All field names are camelCase on the wire. Keep this file, the Rust `PiSidecarLine`
// enum, and the renderer `PiAgentHostEvent` union in lockstep — the contract gate
// (scripts/check-pi-wire-contract.mjs + the Rust fixture test) fails on drift.
//
// Bump PI_HOST_PROTOCOL_VERSION whenever a line's required shape changes; the Rust
// host validates the `ready` handshake against its own copy of this constant and
// refuses a stale bundled host.

export const PI_HOST_PROTOCOL_VERSION = 4;

export const PI_WIRE_KINDS = Object.freeze([
  'ready',
  'started',
  'messageDelta',
  'messageEnd',
  'tool',
  'uiRequest',
  'mcpCall',
  'worktreeCall',
  'agentRun',
  'result',
  'error',
]);

// The WorkKind enum (mirror of packages/shared-types WorkKind) — the kinds the
// delegate tool may stamp on a run. Single source for the host scripts so the
// delegate schema (literal union) and the supervisor's guard can't drift; the
// bundled .mjs host can't import the TS type, so the values live here.
export const WORK_KINDS = Object.freeze([
  'plan',
  'research',
  'design',
  'implement',
  'review',
  'test',
  'compute',
  'publish',
  'present',
  'coordinate',
]);

// Drop undefined-valued keys so the builder's in-memory object matches the
// on-wire JSON exactly. The production emit path would already strip them via
// JSON.stringify; this matters for the contract gate, whose key-by-key deep-equal
// compares a rebuilt line against a fixture that never carries undefined keys.
function withoutUndefined(line) {
  const out = {};
  for (const [key, value] of Object.entries(line)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function readyLine() {
  return { kind: 'ready', protocolVersion: PI_HOST_PROTOCOL_VERSION };
}

export function startedLine({ sessionId, sessionFile, model, modelFallbackMessage } = {}) {
  return withoutUndefined({
    kind: 'started',
    sessionId,
    sessionFile,
    model,
    modelFallbackMessage,
  });
}

export function messageDeltaLine({ delta, channel } = {}) {
  return withoutUndefined({ kind: 'messageDelta', delta, channel });
}

export function messageEndLine({ text, stopReason, errorMessage } = {}) {
  return withoutUndefined({ kind: 'messageEnd', text, stopReason, errorMessage });
}

export function toolLine({ status, toolCallId, toolName, detail, durationMs } = {}) {
  return withoutUndefined({
    kind: 'tool',
    status,
    toolCallId,
    toolName,
    detail,
    durationMs,
  });
}

// A Pi extension paused mid-run and asked the user something through `ctx.ui`
// (confirm / select / input / editor). This forwards that request to the client;
// the client answers with a `uiResponse` line written back to the host's stdin.
// Mirrors Pi RPC's `extension_ui_request` so a future move to RPC mode is a rename.
export function uiRequestLine({ id, method, title, message, options, placeholder, prefill } = {}) {
  return withoutUndefined({
    kind: 'uiRequest',
    id,
    method,
    title,
    message,
    options,
    placeholder,
    prefill,
  });
}

// The host's MCP bridge extension wants to invoke an MCP tool. Unlike every
// other line, `mcpCall` is NOT forwarded to the renderer: the Rust host
// intercepts it in-process, calls mcp_bridge::call_tool against the connected
// MCP server, and writes a matching `mcpResult` line back to the host's stdin
// (the inbound channel, like `uiResponse`). `id` correlates the call with its
// result; `arguments` is the opaque tool-input object (free-form, not part of
// the camelCase envelope contract).
export function mcpCallLine({ id, server, tool, arguments: args } = {}) {
  return withoutUndefined({
    kind: 'mcpCall',
    id,
    server,
    tool,
    arguments: args,
  });
}

// The host-side workspace lease manager needs git worktree I/O. Like mcpCall,
// this is intercepted by Rust in-process and answered on stdin with a
// worktreeResult; the renderer is not in the child-allocation path. `args` is an
// opaque operation payload because paths/branches are validated by Rust git.rs.
export function worktreeCallLine({ id, op, args } = {}) {
  return withoutUndefined({
    kind: 'worktreeCall',
    id,
    op,
    args,
  });
}

// A delegation run-tree event (root agent delegated to a child, child progress,
// child finished). The neutral envelope: scope fields + `runType` (the
// AgentRunEvent.type) + an opaque `payload`. The renderer rebuilds the
// `AgentRunEvent` and emits it on the bus as a single `agent.run` family event.
// `runType` (not `type`) sidesteps the Rust `type` keyword; `payload` stays
// opaque so the wire is stable as new run-event types are added.
export function agentRunLine({
  threadId,
  rootRunId,
  runId,
  parentRunId,
  employeeId,
  relation,
  workKind,
  runType,
  payload,
} = {}) {
  return withoutUndefined({
    kind: 'agentRun',
    threadId,
    rootRunId,
    runId,
    parentRunId,
    employeeId,
    relation,
    workKind,
    runType,
    payload,
  });
}

export function resultLine(response) {
  return { kind: 'result', response };
}

export function errorLine({ code, message } = {}) {
  return { kind: 'error', code, message };
}

// kind -> builder dispatch, used by the contract gate to prove a fixture line is
// reproducible from the same builders the production host uses.
export const PI_WIRE_BUILDERS = Object.freeze({
  ready: () => readyLine(),
  started: startedLine,
  messageDelta: messageDeltaLine,
  messageEnd: messageEndLine,
  tool: toolLine,
  uiRequest: uiRequestLine,
  mcpCall: mcpCallLine,
  worktreeCall: worktreeCallLine,
  agentRun: agentRunLine,
  result: (line) => resultLine(line.response),
  error: errorLine,
});
