import assert from 'node:assert/strict';
import {
  PROVIDER_LIST_REFRESH_MAX_BODY_BYTES,
  pullLatestProviderList,
} from '../packages/ui-office/src/lib/provider-list-refresh.ts';

const urlBodies = new Map<string, string>([
  ['hermes-agent', 'provider: `openrouter`\nSupported providers: `anthropic`'],
  ['openclaw', '- Providers: `openai`, `google`'],
  ['model_prices_and_context_window', JSON.stringify({ 'openai/gpt-4o': { litellm_provider: 'openai' } })],
  ['provider_endpoints_support', JSON.stringify({ providers: { openai: {}, anthropic: {} } })],
  ['openrouter.ai', JSON.stringify({ data: [{ id: 'openrouter/test-model' }] })],
]);

function fetchByKnownUrl(
  overrides?: Partial<{
    response: Response;
    assertInit: boolean;
  }>,
): typeof fetch {
  return async (url, init) => {
    if (overrides?.assertInit) {
      assert.equal(init?.redirect, 'manual');
      assert.equal(init?.cache, 'no-store');
      assert.ok(init?.signal);
    }
    if (overrides?.response) return overrides.response;
    const key = [...urlBodies.keys()].find((candidate) => String(url).includes(candidate));
    assert.ok(key, `unexpected URL: ${String(url)}`);
    return new Response(urlBodies.get(key), {
      status: 200,
      headers: { 'content-type': key === 'openclaw' || key === 'hermes-agent' ? 'text/plain' : 'application/json' },
    });
  };
}

async function expectRejectsWithMessage(fn: () => Promise<unknown>, needle: string): Promise<void> {
  await assert.rejects(fn, (err) => err instanceof Error && err.message.includes(needle));
}

async function main(): Promise<void> {
  {
    const snapshot = await pullLatestProviderList(fetchByKnownUrl({ assertInit: true }));
    assert.ok(snapshot.modelsByProductId['openai-api']?.includes('gpt-4o'));
    assert.ok(snapshot.modelsByProductId.openrouter?.includes('openrouter/test-model'));
  }

  await expectRejectsWithMessage(
    () => pullLatestProviderList(fetchByKnownUrl({ response: new Response('', { status: 302 }) })),
    'redirected',
  );

  await expectRejectsWithMessage(
    () =>
      pullLatestProviderList(
        fetchByKnownUrl({
          response: new Response('', {
            status: 200,
            headers: { 'content-length': String(PROVIDER_LIST_REFRESH_MAX_BODY_BYTES + 1) },
          }),
        }),
      ),
    'exceeded',
  );

  await expectRejectsWithMessage(
    () =>
      pullLatestProviderList(
        fetchByKnownUrl({
          response: new Response('x'.repeat(PROVIDER_LIST_REFRESH_MAX_BODY_BYTES + 1), {
            status: 200,
          }),
        }),
      ),
    'exceeded',
  );

  await expectRejectsWithMessage(
    () =>
      pullLatestProviderList(
        fetchByKnownUrl({
          response: {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0),
          } as Response,
        }),
      ),
    'readable stream',
  );
}

await main();
