// Cross-language wire-contract gate for the Pi Agent host.
//
// Guards both Pi Agent JSONL directions. For host→Rust events it proves the event
// fixture is reproducible from the production Node builders and decodable by Rust.
// For Rust→host requests it runs the checked-in raw payloads through the same
// production decoder imported by tauri-pi-agent-host.entry.mjs; Rust cargo tests
// rebuild those raw payloads from the same fixture. Both envelopes are camelCase,
// deterministic, and fail here when either language drops or renames a field.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PI_HOST_PROTOCOL_VERSION,
  PI_REQUEST_SPEC,
  PI_WIRE_BUILDERS,
  PI_WIRE_KINDS,
  RUN_FAILURE_KINDS,
  decodePiRequestPayload,
} from './pi-agent-host-wire.mjs';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/pi-wire-contract.json', import.meta.url));
const REQUEST_FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/pi-request-contract.json', import.meta.url),
);
const RUST_WIRE_PATH = fileURLToPath(
  new URL('../apps/desktop/src-tauri/src/pi_agent_host/wire.rs', import.meta.url),
);
const RECOVERY_PATH = fileURLToPath(
  new URL(
    '../apps/desktop/renderer/src/runtime/recovery/reconcile-interrupted-runs.ts',
    import.meta.url,
  ),
);

const SPEC = {
  ready: { required: ['protocolVersion'], allowed: ['protocolVersion'] },
  started: {
    required: [],
    allowed: ['sessionId', 'sessionFile', 'model', 'modelFallbackMessage'],
  },
  messageDelta: { required: ['delta'], allowed: ['delta', 'channel'] },
  messageEnd: { required: ['text'], allowed: ['text', 'stopReason', 'errorMessage'] },
  tool: {
    required: ['status', 'toolCallId', 'toolName'],
    allowed: ['status', 'toolCallId', 'toolName', 'detail', 'durationMs'],
  },
  uiRequest: {
    required: ['id', 'method', 'title'],
    allowed: ['id', 'method', 'title', 'message', 'options', 'placeholder', 'prefill'],
  },
  mcpCall: {
    required: ['id', 'server', 'tool'],
    allowed: ['id', 'server', 'tool', 'arguments'],
  },
  worktreeCall: {
    required: ['id', 'op'],
    allowed: ['id', 'op', 'args'],
  },
  verifyCall: {
    required: ['id', 'command', 'cwd', 'projectId'],
    allowed: ['id', 'command', 'cwd', 'projectId'],
  },
  agentRun: {
    required: ['threadId', 'rootRunId', 'runId', 'runType', 'payload'],
    allowed: [
      'threadId',
      'rootRunId',
      'runId',
      'parentRunId',
      'employeeId',
      'relation',
      'workKind',
      'runType',
      'payload',
    ],
  },
  result: { required: ['response'], allowed: ['response'] },
  error: { required: ['code', 'message'], allowed: ['code', 'message'] },
};

function fail(message) {
  throw new Error(`Pi wire contract: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function protocolLiteral(path, pattern, label) {
  const source = readFileSync(path, 'utf8');
  const match = source.match(pattern);
  assert(match, `${label} protocol version literal was not found`);
  return Number(match[1]);
}

const rustProtocolVersion = protocolLiteral(
  RUST_WIRE_PATH,
  /PI_HOST_PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)\s*;/,
  'Rust host',
);
const recoveryProtocolVersion = protocolLiteral(
  RECOVERY_PATH,
  /export const PI_HOST_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/,
  'renderer recovery',
);
assert(
  rustProtocolVersion === PI_HOST_PROTOCOL_VERSION,
  `Rust protocol version ${rustProtocolVersion} != Node protocol version ${PI_HOST_PROTOCOL_VERSION}`,
);
assert(
  recoveryProtocolVersion === PI_HOST_PROTOCOL_VERSION,
  `renderer recovery protocol version ${recoveryProtocolVersion} != Node protocol version ${PI_HOST_PROTOCOL_VERSION}`,
);

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function scanForSnakeCaseKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSnakeCaseKeys(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assert(
        !key.includes('_'),
        `snake_case key "${key}" at ${path} — the wire contract is camelCase only`,
      );
      scanForSnakeCaseKeys(value[key], `${path}.${key}`);
    }
  }
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
assert(Array.isArray(fixture) && fixture.length > 0, 'fixture must be a non-empty array');

const seenKinds = new Set();

fixture.forEach((line, index) => {
  const where = `line ${index} (${line?.kind ?? 'no kind'})`;
  assert(line && typeof line === 'object' && !Array.isArray(line), `${where}: not an object`);
  const { kind } = line;
  assert(PI_WIRE_KINDS.includes(kind), `${where}: unknown kind "${kind}"`);
  seenKinds.add(kind);

  // No snake_case anywhere, at any nesting depth — EXCEPT opaque operation
  // payloads (`mcpCall.arguments`, `worktreeCall.args`). The envelope stays
  // camelCase-only; opaque args are only required to be plain objects.
  if (kind === 'mcpCall' || kind === 'worktreeCall') {
    const opaqueKey = kind === 'mcpCall' ? 'arguments' : 'args';
    const { [opaqueKey]: args, ...envelope } = line;
    scanForSnakeCaseKeys(envelope, where);
    if (args !== undefined) {
      assert(
        args !== null && typeof args === 'object' && !Array.isArray(args),
        `${where}: ${opaqueKey} must be a plain object`,
      );
    }
  } else {
    scanForSnakeCaseKeys(line, where);
  }

  const spec = SPEC[kind];
  const keys = Object.keys(line).filter((key) => key !== 'kind');
  for (const required of spec.required) {
    assert(keys.includes(required), `${where}: missing required key "${required}"`);
  }
  for (const key of keys) {
    assert(spec.allowed.includes(key), `${where}: unexpected key "${key}"`);
  }
  if (kind === 'messageDelta' && line.channel !== undefined) {
    assert(
      ['content', 'reasoning'].includes(line.channel),
      `${where}: channel must be "content" or "reasoning"`,
    );
  }

  // The fixture line must be reproducible from the production builder for its kind,
  // so the fixture can never drift away from what the Node host actually emits.
  const rebuilt = PI_WIRE_BUILDERS[kind](line);
  assert(
    stableStringify(rebuilt) === stableStringify(line),
    `${where}: builder output diverges from fixture\n  fixture: ${stableStringify(line)}\n  builder: ${stableStringify(rebuilt)}`,
  );
});

const readyLine = fixture.find((line) => line.kind === 'ready');
assert(readyLine, 'fixture must include a ready handshake line');
assert(
  readyLine.protocolVersion === PI_HOST_PROTOCOL_VERSION,
  `ready.protocolVersion ${readyLine.protocolVersion} != PI_HOST_PROTOCOL_VERSION ${PI_HOST_PROTOCOL_VERSION}`,
);

// The typed failure kind rides the opaque agentRun payload (no envelope change,
// no protocol bump) — the fixture must exercise a failed terminal carrying it so
// the Rust round-trip sees a realistic failureKind-bearing payload.
const failedAgentRun = fixture.find(
  (line) => line.kind === 'agentRun' && line.runType === 'run.failed',
);
assert(failedAgentRun, 'fixture must exercise an agentRun run.failed line');
assert(
  failedAgentRun.payload?.status === 'failed' &&
    RUN_FAILURE_KINDS.includes(failedAgentRun.payload?.failureKind),
  'agentRun run.failed payload must carry a typed failureKind (RunFailureKind)',
);

for (const kind of PI_WIRE_KINDS) {
  assert(seenKinds.has(kind), `fixture must exercise every wire kind; missing "${kind}"`);
}

const requestFixture = JSON.parse(readFileSync(REQUEST_FIXTURE_PATH, 'utf8'));
assert(requestFixture?.version === 1, 'request fixture version must be 1');
assert(
  Array.isArray(requestFixture.cases) && requestFixture.cases.length > 0,
  'request fixture cases must be a non-empty array',
);
const seenRequestModes = new Set();
for (const [index, requestCase] of requestFixture.cases.entries()) {
  const where = `request case ${index} (${requestCase?.mode ?? 'no mode'})`;
  assert(
    requestCase && typeof requestCase === 'object' && !Array.isArray(requestCase),
    `${where}: not an object`,
  );
  const { mode, request, context, payload, normalized } = requestCase;
  const spec = PI_REQUEST_SPEC[mode];
  assert(spec, `${where}: unknown request mode "${mode}"`);
  assert(!seenRequestModes.has(mode), `${where}: duplicate request mode`);
  seenRequestModes.add(mode);

  for (const [label, value] of Object.entries({ request, context, payload, normalized })) {
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      `${where}: ${label} must be an object`,
    );
    scanForSnakeCaseKeys(value, `${where}.${label}`);
  }

  assert(payload.mode === mode, `${where}: payload mode must equal case mode`);
  const payloadKeys = Object.keys(payload);
  for (const required of spec.required) {
    assert(payloadKeys.includes(required), `${where}: payload missing required key "${required}"`);
  }
  for (const key of payloadKeys) {
    assert(spec.allowed.includes(key), `${where}: payload has unexpected key "${key}"`);
  }
  const normalizedKeys = Object.keys(normalized);
  for (const required of spec.required) {
    assert(normalizedKeys.includes(required), `${where}: normalized payload missing "${required}"`);
  }
  for (const key of normalizedKeys) {
    assert(spec.allowed.includes(key), `${where}: normalized payload has unexpected key "${key}"`);
  }

  // This is the production decoder imported by tauri-pi-agent-host.entry.mjs,
  // not a source-text approximation. A missing field mapping changes behavior
  // and makes this deep comparison fail.
  const decoded = decodePiRequestPayload(payload);
  assert(
    stableStringify(decoded) === stableStringify(normalized),
    `${where}: production request decoder diverges from fixture\n  fixture: ${stableStringify(normalized)}\n  decoded: ${stableStringify(decoded)}`,
  );

  for (const key of spec.nullable) {
    const nullablePayload = { ...payload, [key]: null };
    assert(
      decodePiRequestPayload(nullablePayload)[key] === null,
      `${where}: nullable key "${key}" must accept and preserve null`,
    );
  }
  for (const key of spec.required.filter((entry) => !spec.nullable.includes(entry))) {
    let rejectedNull = false;
    try {
      decodePiRequestPayload({ ...payload, [key]: null });
    } catch (error) {
      rejectedNull = error?.code === 'invalid-request';
    }
    assert(rejectedNull, `${where}: non-nullable key "${key}" must reject null`);
  }
}

for (const mode of Object.keys(PI_REQUEST_SPEC)) {
  assert(seenRequestModes.has(mode), `request fixture must exercise mode "${mode}"`);
}

let rejectedUnknownMode = false;
try {
  decodePiRequestPayload({ mode: 'unknown' });
} catch (error) {
  rejectedUnknownMode = error?.code === 'invalid-request';
}
assert(rejectedUnknownMode, 'production request decoder must reject unknown modes');

let rejectedUnexpectedKey = false;
try {
  decodePiRequestPayload({
    ...requestFixture.cases.find((entry) => entry.mode === 'execute').payload,
    unexpectedKey: true,
  });
} catch (error) {
  rejectedUnexpectedKey = error?.code === 'invalid-request';
}
assert(rejectedUnexpectedKey, 'production request decoder must reject unexpected keys');

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'pi-wire-contract',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      kinds: PI_WIRE_KINDS.length,
      fixtureLines: fixture.length,
      requestModes: seenRequestModes.size,
      requestCases: requestFixture.cases.length,
    },
    null,
    2,
  ),
);
