import assert from 'node:assert/strict';
import {
  RegistryApiError,
  RegistryClient,
  REGISTRY_CLIENT_MAX_JSON_BYTES,
} from '../packages/registry-client/src/index.ts';

function createClient(fetchImpl: typeof globalThis.fetch): RegistryClient {
  return new RegistryClient({
    baseUrl: 'https://registry.example.test',
    fetch: fetchImpl,
  });
}

async function expectRejectsWithMessage(fn: () => Promise<unknown>, needle: string): Promise<void> {
  await assert.rejects(fn, (err) => err instanceof Error && err.message.includes(needle));
}

async function main(): Promise<void> {
  {
    const seen: string[] = [];
    const client = createClient(async (url, init) => {
      seen.push(String(url));
      assert.equal(init?.redirect, 'manual');
      assert.ok(init?.signal);
      return new Response(JSON.stringify({ listings: [], page: 1, per_page: 20, total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await client.searchListings();
    assert.equal(result.total, 0);
    assert.deepEqual(seen, ['https://registry.example.test/v1/market/search?']);
  }

  {
    const client = createClient(async () => new Response('', { status: 302 }));
    await assert.rejects(
      () => client.searchListings(),
      (err) =>
        err instanceof RegistryApiError &&
        err.status === 302 &&
        err.code === 'REDIRECT_NOT_ALLOWED',
    );
  }

  {
    const client = createClient(
      async () =>
        new Response('', {
          status: 200,
          headers: { 'content-length': String(REGISTRY_CLIENT_MAX_JSON_BYTES + 1) },
        }),
    );
    await expectRejectsWithMessage(() => client.searchListings(), 'exceeded');
  }

  {
    const client = createClient(
      async () =>
        new Response('x'.repeat(REGISTRY_CLIENT_MAX_JSON_BYTES + 1), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expectRejectsWithMessage(() => client.searchListings(), 'exceeded');
  }

  {
    const client = createClient(
      async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          body: null,
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as Response,
    );
    await expectRejectsWithMessage(() => client.searchListings(), 'readable stream');
  }
}

await main();
