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

export const PI_HOST_PROTOCOL_VERSION = 1;

export const PI_WIRE_KINDS = Object.freeze([
  'ready',
  'started',
  'messageDelta',
  'messageEnd',
  'tool',
  'permissionRequest',
  'result',
  'error',
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

// Ask mode: the host pauses a destructive tool and asks the renderer to approve.
// The renderer answers with a decision line written back to the host's stdin.
export function permissionRequestLine({ toolCallId, toolName, command, reason } = {}) {
  return withoutUndefined({
    kind: 'permissionRequest',
    toolCallId,
    toolName,
    command,
    reason,
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
  permissionRequest: permissionRequestLine,
  result: (line) => resultLine(line.response),
  error: errorLine,
});
