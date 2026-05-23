import {
  WEB_SEARCH_MAX_BODY_BYTES,
  createWebSearchTool,
  readWebSearchTextWithLimit,
} from '../packages/core/src/tools/builtin/web-search-tool.ts';

await expectRejects(
  readWebSearchTextWithLimit(
    new Response('x'.repeat(WEB_SEARCH_MAX_BODY_BYTES + 1), {
      headers: { 'content-length': String(WEB_SEARCH_MAX_BODY_BYTES + 1) },
    }),
  ),
  'web_search accepted oversized provider response',
);

await expectRejects(
  readWebSearchTextWithLimit({
    headers: new Headers(),
    body: null,
    text: async () => 'x'.repeat(WEB_SEARCH_MAX_BODY_BYTES + 1),
  } as Response),
  'web_search accepted oversized no-stream provider response',
);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () =>
    new Response('', {
      status: 302,
      headers: { Location: 'https://duckduckgo.com/html/?q=offisim' },
    })) as typeof fetch;
  const redirected = await createWebSearchTool().execute({ query: 'offisim' });
  if (!String(redirected).includes('redirect was blocked')) {
    throw new Error(`web_search did not report blocked redirect: ${String(redirected)}`);
  }

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        Abstract: 'Offisim result',
        RelatedTopics: [{ Text: 'Related result' }],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  const result = await createWebSearchTool().execute({ query: 'offisim' });
  if (!String(result).includes('Offisim result') || !String(result).includes('Related result')) {
    throw new Error(`web_search failed valid provider response: ${String(result)}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Web search security harness passed.');

async function expectRejects(fn: Promise<unknown>, message: string): Promise<void> {
  try {
    await fn;
  } catch {
    return;
  }
  throw new Error(message);
}
