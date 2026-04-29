import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureRuntimeBuild } from './harness-lib.mjs';
import {
  REPLAY_SCENARIO_IDS,
  SCENARIOS_DIR,
  loadHarnessScenarios,
} from './harness-scenario-loader.mjs';

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });

const core = await import(
  new URL('../packages/core/dist/testing/fake-gateway.js', import.meta.url).href
);
const replay = await import(
  new URL('../packages/core/dist/testing/replay-gateway.js', import.meta.url).href
);
const scenarioRunner = await import(
  new URL('../packages/core/dist/testing/scenario-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const request = {
  model: 'fake-model',
  messages: [{ role: 'user', content: 'hello replay' }],
};
const response = core.fakeResponse('hello deterministic replay', {
  toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: { path: 'README.md' } }],
  inputTokens: 3,
  outputTokens: 4,
});
const requestHashes = await replay.replayRequestHashes(request);
const key = replay.fixtureKeyFromHashes(requestHashes);
if (key !== (await replay.fixtureKey(request))) {
  throw new Error('Replay fixture key helper mismatch');
}
const gateway = new replay.ReplayGateway(new Map([[key, response]]));
const actual = await gateway.chat(request);

if (JSON.stringify(actual) !== JSON.stringify(response)) {
  throw new Error('ReplayGateway response mismatch');
}

const fakeGateway = new core.FakeGateway([
  { id: 'turn-1', match: { contains: 'hello replay' }, response },
]);
const streamChunks = [];
for await (const chunk of fakeGateway.chatStream(request)) {
  streamChunks.push(chunk);
}

if (!streamChunks.at(-1)?.toolCalls?.[0] || streamChunks.at(-1).toolCalls[0].name !== 'read_file') {
  throw new Error('FakeGateway stream did not preserve tool call');
}

const scenarioReports = [];
const llmRecordingReports = [];
for (const scenario of loadLlmRecordingScenarios()) {
  llmRecordingReports.push(await runLlmRecordingScenario(scenario, replay));
}
for (const scenario of loadHarnessScenarios()) {
  scenarioReports.push(await scenarioRunner.runDeterministicScenario(scenario));
}

const failedReports = [...llmRecordingReports, ...scenarioReports].filter(
  (report) => !report.passed,
);
if (failedReports.length > 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        suite: 'replay',
        failed: failedReports.map((report) => ({
          scenarioId: report.scenarioId,
          traceHash: report.traceHash,
          assertions: report.assertions,
          trace: report.trace,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'replay',
      fixtureKey: key,
      requestHashes,
      requestCount: gateway.requests.length,
      streamChunks: streamChunks.length,
      scenarios: scenarioReports.map((report) => ({
        scenarioId: report.scenarioId,
        passed: report.passed,
        traceHash: report.traceHash,
        assertions: report.assertions,
      })),
      llmRecordingScenarios: llmRecordingReports.map((report) => ({
        scenarioId: report.scenarioId,
        passed: report.passed,
        assertions: report.assertions,
      })),
      scenarioIds: REPLAY_SCENARIO_IDS,
    },
    null,
    2,
  ),
);

function loadLlmRecordingScenarios() {
  return ['recorded-stream-tool-call-replay', 'stream-nonstream-middleware-parity'].map((id) =>
    JSON.parse(readFileSync(resolve(SCENARIOS_DIR, `${id}.json`), 'utf8')),
  );
}

async function runLlmRecordingScenario(scenario, replayModule) {
  const assertions = [];
  const fixture = scenario.fixture;
  const request = fixture?.request;
  const response = fixture?.response;
  if (!request || !response) {
    return {
      scenarioId: scenario.id,
      passed: false,
      traceHash: 'missing-fixture',
      assertions: [
        {
          kind: 'llmRecording.fixture_present',
          passed: false,
          message: 'llm-recording scenario must provide fixture.request and fixture.response',
        },
      ],
      trace: {},
    };
  }

  const key = await replayModule.fixtureKey(request);
  const directGateway = new replayModule.ReplayGateway(new Map([[key, response]]));
  const direct = await directGateway.chat(request);
  assertions.push({
    kind: 'replayFixtureKeyMatchesRequest',
    passed: JSON.stringify(direct) === JSON.stringify(response),
    message:
      JSON.stringify(direct) === JSON.stringify(response)
        ? undefined
        : 'ReplayGateway did not return fixture response',
  });

  const streamGateway = new replayModule.ReplayGateway(new Map([[key, response]]));
  const streamChunks = [];
  for await (const chunk of streamGateway.chatStream(request)) {
    streamChunks.push(chunk);
  }
  const reconstructed = reconstructStreamResponse(streamChunks);
  for (const assertion of scenario.assertions ?? []) {
    if (assertion.kind === 'replayStreamPreservesToolCall') {
      const toolName = streamChunks.at(-1)?.toolCalls?.[0]?.name;
      assertions.push({
        kind: assertion.kind,
        passed: toolName === assertion.toolName,
        message:
          toolName === assertion.toolName
            ? undefined
            : `Expected streamed tool ${assertion.toolName}, got ${toolName ?? '<missing>'}`,
      });
    }
    if (assertion.kind === 'replayStreamMatchesNonStream') {
      assertions.push({
        kind: assertion.kind,
        passed: JSON.stringify(reconstructed) === JSON.stringify(response),
        message:
          JSON.stringify(reconstructed) === JSON.stringify(response)
            ? undefined
            : `Stream/nonstream mismatch: ${JSON.stringify(reconstructed)}`,
      });
    }
  }

  return {
    scenarioId: scenario.id,
    passed: assertions.every((assertion) => assertion.passed),
    traceHash: key,
    assertions,
    trace: {
      request,
      response,
      streamChunks,
      requestCount: directGateway.requests.length + streamGateway.requests.length,
    },
  };
}

function reconstructStreamResponse(chunks) {
  return {
    content: chunks.map((chunk) => chunk.content ?? '').join(''),
    ...(chunks.some((chunk) => chunk.reasoning)
      ? { reasoningContent: chunks.map((chunk) => chunk.reasoning ?? '').join('') }
      : {}),
    toolCalls: chunks.at(-1)?.toolCalls ?? [],
    usage: chunks.at(-1)?.usage,
  };
}
