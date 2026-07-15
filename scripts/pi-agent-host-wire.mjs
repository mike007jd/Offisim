// Single source of truth for both directions of the Pi Agent host JSONL wire contract.
//
// The Node host (scripts/tauri-pi-agent-host.entry.mjs) builds every stdout line
// through the helpers below, the Rust bridge (apps/desktop/src-tauri/src/pi_agent_host/)
// decodes the same shapes, and the renderer (desktop-agent-runtime.ts) consumes them.
// All field names are camelCase on the wire. Keep this file, the Rust `PiSidecarLine`
// enum, and the renderer `PiAgentHostEvent` union in lockstep — the contract gate
// (scripts/check-pi-wire-contract.mjs + the Rust fixture test) fails on drift.
//
// Bump PI_HOST_PROTOCOL_VERSION whenever a line's required shape changes; the Rust
// host validates the `ready` handshake against its own copy of this constant and
// refuses a stale bundled host.

export const PI_HOST_PROTOCOL_VERSION = 8;

export const PI_WIRE_KINDS = Object.freeze([
  'ready',
  'started',
  'messageDelta',
  'messageEnd',
  'tool',
  'uiRequest',
  'lifecycle',
  'mcpCall',
  'worktreeCall',
  'verifyCall',
  'agentRun',
  'result',
  'error',
]);

const requestSpec = (keys, nullable = [], optional = []) =>
  Object.freeze({
    required: Object.freeze([...keys]),
    allowed: Object.freeze([...keys, ...optional]),
    nullable: Object.freeze([...nullable]),
  });

// Rust emits these three request envelopes and the Node entrypoint decodes them
// before dispatch. Optional values remain present as JSON null, so the key set is
// exact even when a model/persona/scope override is absent. companyId is enforced
// at the Tauri request boundary but is not consumed by the Node host; the redundant
// collaboration capabilityProfile is likewise not part of this wire envelope.
export const PI_REQUEST_SPEC = Object.freeze({
  execute: requestSpec(
    [
      'mode',
      'text',
      'images',
      'cwd',
      'sessionDir',
      'agentDir',
      'model',
      'permissionMode',
      'thinkingLevel',
      'systemPromptAppend',
      'skillPaths',
      'threadId',
      'projectId',
      'projectVerifyCommand',
      'projectVerifyMaxAttempts',
      'projectVerifyTokenBudget',
      'employeeId',
      'rootRunId',
      'roster',
      'missionContextJson',
      'mcpTools',
    ],
    [
      'agentDir',
      'images',
      'model',
      'permissionMode',
      'thinkingLevel',
      'systemPromptAppend',
      'skillPaths',
      'projectId',
      'projectVerifyCommand',
      'projectVerifyMaxAttempts',
      'projectVerifyTokenBudget',
      'employeeId',
      'rootRunId',
      'roster',
      'missionContextJson',
      'mcpTools',
    ],
    ['directDelegation', 'delegationLimits', 'resumeMode', 'resumeSessionFile'],
  ),
  enhance: requestSpec(
    ['mode', 'text', 'systemPrompt', 'cwd', 'agentDir', 'model', 'thinkingLevel'],
    ['agentDir', 'model', 'thinkingLevel'],
  ),
  collaborate: requestSpec(
    [
      'mode',
      'requestId',
      'text',
      'collaborationProfile',
      'mcpTools',
      'cwd',
      'agentDir',
      'collaborationThreadId',
      'employeeId',
      'model',
      'thinkingLevel',
      'systemPromptAppend',
    ],
    [
      'collaborationProfile',
      'mcpTools',
      'agentDir',
      'employeeId',
      'model',
      'thinkingLevel',
      'systemPromptAppend',
    ],
  ),
});

const PI_REQUEST_NORMALIZERS = Object.freeze({
  execute: (payload) => ({
    mode: payload.mode,
    text: payload.text,
    images: payload.images,
    cwd: payload.cwd,
    sessionDir: payload.sessionDir,
    agentDir: payload.agentDir,
    model: payload.model,
    permissionMode: payload.permissionMode,
    thinkingLevel: payload.thinkingLevel,
    systemPromptAppend: payload.systemPromptAppend,
    skillPaths: payload.skillPaths,
    threadId: payload.threadId,
    projectId: payload.projectId,
    projectVerifyCommand: payload.projectVerifyCommand,
    projectVerifyMaxAttempts: payload.projectVerifyMaxAttempts,
    projectVerifyTokenBudget: payload.projectVerifyTokenBudget,
    employeeId: payload.employeeId,
    rootRunId: payload.rootRunId,
    roster: payload.roster,
    missionContextJson: payload.missionContextJson,
    mcpTools: payload.mcpTools,
    ...(payload.resumeMode !== undefined ? { resumeMode: payload.resumeMode } : {}),
    ...(payload.resumeSessionFile !== undefined
      ? { resumeSessionFile: payload.resumeSessionFile }
      : {}),
    ...(payload.directDelegation !== undefined
      ? { directDelegation: payload.directDelegation }
      : {}),
    ...(payload.delegationLimits !== undefined
      ? { delegationLimits: payload.delegationLimits }
      : {}),
  }),
  enhance: (payload) => ({
    mode: payload.mode,
    text: payload.text,
    systemPrompt: payload.systemPrompt,
    cwd: payload.cwd,
    agentDir: payload.agentDir,
    model: payload.model,
    thinkingLevel: payload.thinkingLevel,
  }),
  collaborate: (payload) => ({
    mode: payload.mode,
    requestId: payload.requestId,
    text: payload.text,
    collaborationProfile: payload.collaborationProfile,
    mcpTools: payload.mcpTools,
    cwd: payload.cwd,
    agentDir: payload.agentDir,
    collaborationThreadId: payload.collaborationThreadId,
    employeeId: payload.employeeId,
    model: payload.model,
    thinkingLevel: payload.thinkingLevel,
    systemPromptAppend: payload.systemPromptAppend,
  }),
});

export function decodePiRequestPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Pi Agent request payload must be an object.'), {
      code: 'invalid-request',
    });
  }
  const mode = typeof payload.mode === 'string' ? payload.mode : '';
  const spec = PI_REQUEST_SPEC[mode];
  const normalize = PI_REQUEST_NORMALIZERS[mode];
  if (!spec || !normalize) {
    throw Object.assign(new Error(`Unknown Pi Agent request mode: ${mode || '(missing)'}.`), {
      code: 'invalid-request',
    });
  }
  const keys = Object.keys(payload);
  const missing = spec.required.filter((key) => !Object.hasOwn(payload, key));
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Pi Agent ${mode} request is missing keys: ${missing.join(', ')}.`),
      { code: 'invalid-request' },
    );
  }
  const invalidNulls = spec.required.filter(
    (key) => payload[key] === null && !spec.nullable.includes(key),
  );
  if (invalidNulls.length > 0) {
    throw Object.assign(
      new Error(`Pi Agent ${mode} request has null non-nullable keys: ${invalidNulls.join(', ')}.`),
      { code: 'invalid-request' },
    );
  }
  const unexpected = keys.filter((key) => !spec.allowed.includes(key));
  if (unexpected.length > 0) {
    throw Object.assign(
      new Error(`Pi Agent ${mode} request has unexpected keys: ${unexpected.join(', ')}.`),
      { code: 'invalid-request' },
    );
  }
  return normalize(payload);
}

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

// The RunFailureKind enum (mirror of packages/shared-types RunFailureKind) —
// the typed cause a run.failed finished payload must carry. Same single-source
// rationale as WORK_KINDS: the .mjs hosts and the contract gate share these
// values so emitters and checker can't drift from the TS union.
export const RUN_FAILURE_KINDS = Object.freeze([
  'token',
  'budget',
  'permission',
  'context',
  'runtime',
  'tool',
]);

/** Throw unless `kind` is a RunFailureKind — the emit helpers call this so no
 *  failure path can ship an untyped run.failed. Fail loud (prelaunch). */
export function assertRunFailureKind(kind) {
  if (!RUN_FAILURE_KINDS.includes(kind)) {
    throw new Error(`run.failed requires a typed RunFailureKind, got: ${String(kind)}`);
  }
}

// Classify a provider/model failure message into a typed RunFailureKind at the
// point where the free text originates (session error stops, thrown transport
// errors). This is the ONLY place failure text may be interpreted — the wire
// carries the typed kind from here on and no downstream consumer re-parses
// summaries. Order matters: context-window messages usually mention "tokens",
// so the context test runs before the token test. Unrecognized text is host/
// provider machinery → 'runtime'.
export function classifyRunFailure(message) {
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (/(context|prompt)[^.]{0,40}(length|window|too long|exceed)|\bcompact/.test(text)) {
    return 'context';
  }
  if (/\btokens?\b|quota|rate.?limit|\b429\b/.test(text)) return 'token';
  if (/permission|unauthorized|forbidden|denied|\b401\b|\b403\b/.test(text)) return 'permission';
  if (/budget|cost.?limit|spend.?limit/.test(text)) return 'budget';
  return 'runtime';
}

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

// Pi owns queueing, compaction, retry, and context accounting. Offisim only
// projects those native lifecycle facts so users can see what the runtime is
// doing without recreating any of the underlying policies.
export function lifecycleLine({ event, payload } = {}) {
  return withoutUndefined({ kind: 'lifecycle', event, payload });
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

export function verifyCallLine({ id, command, cwd, projectId } = {}) {
  return withoutUndefined({ kind: 'verifyCall', id, command, cwd, projectId });
}

// A delegation run-tree event (root agent delegated to a child, child progress,
// child finished). The neutral envelope: scope fields + `runType` (the
// AgentRunEvent.type) + an opaque `payload`. The renderer rebuilds the
// `AgentRunEvent` and emits it on the bus as a single `agent.run` family event.
// `runType` (not `type`) sidesteps the Rust `type` keyword; `payload` stays
// opaque so the wire is stable as new run-event types are added. A `run.failed`
// finished payload carries a typed `failureKind` (RunFailureKind) stamped by the
// emitter — it rides the opaque payload verbatim (no envelope change).
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
  lifecycle: lifecycleLine,
  mcpCall: mcpCallLine,
  worktreeCall: worktreeCallLine,
  verifyCall: verifyCallLine,
  agentRun: agentRunLine,
  result: (line) => resultLine(line.response),
  error: errorLine,
});
