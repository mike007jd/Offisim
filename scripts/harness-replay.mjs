import { ensureRuntimeBuild } from './harness-lib.mjs';

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });

const core = await import(
  new URL('../packages/core/dist/testing/fake-gateway.js', import.meta.url).href
);
const replay = await import(
  new URL('../packages/core/dist/testing/replay-gateway.js', import.meta.url).href
);

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

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'replay',
      fixtureKey: key,
      requestHashes,
      requestCount: gateway.requests.length,
      streamChunks: streamChunks.length,
    },
    null,
    2,
  ),
);
