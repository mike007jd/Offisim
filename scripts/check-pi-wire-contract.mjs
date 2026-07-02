// Cross-language wire-contract gate for the Pi Agent host.
//
// Guards the exact class of bug that shipped to a live build: the Node host emits
// camelCase keys, but the contract was never exercised past `mode:'status'`, so a
// snake/camel divergence between the Node emitter and the Rust decoder went
// undetected. This gate proves the checked-in fixture (scripts/fixtures/pi-wire-contract.json)
// is reproducible from the same builders the production host uses, is fully camelCase,
// and carries the current protocol version. The Rust side reads the SAME fixture in a
// cargo test (pi_agent_host.rs), so Node and Rust cannot drift apart silently.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PI_HOST_PROTOCOL_VERSION,
  PI_WIRE_BUILDERS,
  PI_WIRE_KINDS,
  RUN_FAILURE_KINDS,
} from './pi-agent-host-wire.mjs';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/pi-wire-contract.json', import.meta.url));

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

console.log(
  JSON.stringify(
    {
      ok: true,
      gate: 'pi-wire-contract',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      kinds: PI_WIRE_KINDS.length,
      fixtureLines: fixture.length,
    },
    null,
    2,
  ),
);
