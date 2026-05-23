import {
  A2A_AGENT_CARD_MAX_BYTES,
  A2AClient,
  assertJsonRpcInterfacesStayOnPeer,
  readResponseTextWithLimit,
  validateA2AExternalUrl,
} from '../packages/core/src/a2a/index.js';
import type { A2AAgentCard } from '../packages/core/src/a2a/index.js';
import {
  AgentCardDiscoveryError,
  discoverAgentCard,
  readResponseTextWithLimit as readUiResponseTextWithLimit,
  validateExternalAgentBaseUrl,
} from '../packages/ui-office/src/lib/agent-card-discovery.js';

const validCard: A2AAgentCard = {
  name: 'Remote',
  description: 'Remote agent',
  supportedInterfaces: [
    { url: 'https://agent.example.com/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  version: '1.0.0',
  capabilities: {},
};

for (const url of [
  'http://agent.example.com',
  'https://localhost:4100',
  'https://127.0.0.1:4100',
  'https://10.0.0.5',
  'https://169.254.169.254/latest/meta-data',
  'https://metadata.google.internal',
]) {
  expectThrows(() => validateA2AExternalUrl(url), `core accepted denied URL: ${url}`);
  expectThrows(() => validateExternalAgentBaseUrl(url), `ui accepted denied URL: ${url}`);
}

assertJsonRpcInterfacesStayOnPeer(validCard, new URL('https://agent.example.com'));
expectThrows(
  () =>
    assertJsonRpcInterfacesStayOnPeer(
      {
        ...validCard,
        supportedInterfaces: [
          {
            url: 'https://evil.example.com/rpc',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ],
      },
      new URL('https://agent.example.com'),
    ),
  'core accepted cross-origin JSON-RPC endpoint from agent card',
);

await expectRejects(
  readResponseTextWithLimit(
    new Response('x'.repeat(A2A_AGENT_CARD_MAX_BYTES + 1), {
      headers: { 'content-length': String(A2A_AGENT_CARD_MAX_BYTES + 1) },
    }),
    A2A_AGENT_CARD_MAX_BYTES,
  ),
  'core accepted oversized agent card response',
);

await expectRejects(
  readUiResponseTextWithLimit(
    {
      headers: new Headers(),
      body: null,
      text: async () => 'x'.repeat(A2A_AGENT_CARD_MAX_BYTES + 1),
    } as Response,
    A2A_AGENT_CARD_MAX_BYTES,
  ),
  'ui accepted oversized no-stream agent card response',
);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () =>
    new Response('', {
      status: 302,
      headers: { Location: 'https://agent.example.com/redirected-card.json' },
    });
  await expectRejects(
    new A2AClient({ name: 'Remote', url: 'https://agent.example.com' }).getAgentCard(true),
    'core followed or accepted agent-card redirect',
  );

  (globalThis as unknown as { window: Pick<Window, 'setTimeout' | 'clearTimeout'> }).window = {
    setTimeout,
    clearTimeout,
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ...validCard,
        supportedInterfaces: [
          {
            url: 'https://evil.example.com/rpc',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  await expectRejects(
    discoverAgentCard('https://agent.example.com'),
    'ui accepted cross-origin JSON-RPC endpoint from agent card',
    (err) => err instanceof AgentCardDiscoveryError && err.class === 'schema',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('A2A security harness passed.');

function expectThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

async function expectRejects(
  fn: Promise<unknown>,
  message: string,
  predicate?: (err: unknown) => boolean,
): Promise<void> {
  try {
    await fn;
  } catch (err) {
    if (!predicate || predicate(err)) return;
    throw err;
  }
  throw new Error(message);
}
