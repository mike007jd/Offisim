import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntimeBuild } from './harness-lib.mjs';

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIOS_DIR = resolve(ROOT, 'packages/core/harness/scenarios');
const V1_SCENARIO_IDS = [
  'dag-output-attribution',
  'permission-ask-approved-blocks-and-then-executes',
  'permission-ask-denied-does-not-execute',
  'plan-review-cancel-terminates',
  'plan-review-approve-survives-restore',
];

const core = await import(
  new URL('../packages/core/dist/testing/fake-gateway.js', import.meta.url).href
);
const replay = await import(
  new URL('../packages/core/dist/testing/replay-gateway.js', import.meta.url).href
);
const scenarioRunner = await import(
  new URL('../packages/core/dist/testing/scenario-runner.js', import.meta.url).href
);
const logger = await import(new URL('../packages/core/dist/services/logger.js', import.meta.url).href);
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

const fakeGateway = new core.FakeGateway([{ id: 'turn-1', response }]);
const streamChunks = [];
for await (const chunk of fakeGateway.chatStream(request)) {
  streamChunks.push(chunk);
}

if (!streamChunks.at(-1)?.toolCalls?.[0] || streamChunks.at(-1).toolCalls[0].name !== 'read_file') {
  throw new Error('FakeGateway stream did not preserve tool call');
}

const scenarioReports = [];
for (const id of V1_SCENARIO_IDS) {
  const scenario = JSON.parse(readFileSync(resolve(SCENARIOS_DIR, `${id}.json`), 'utf8'));
  scenarioReports.push(await scenarioRunner.runDeterministicScenario(scenario));
}

const failedReports = scenarioReports.filter((report) => !report.passed);
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
    },
    null,
    2,
  ),
);
