import { readBodyWithByteLimit } from '../../utils/read-body-with-limit.js';
import type { BuiltinTool, WebSearchFn } from './types.js';

export const WEB_SEARCH_MAX_BODY_BYTES = 512 * 1024;
export const WEB_SEARCH_TIMEOUT_MS = 10_000;

/**
 * Default search implementation using DuckDuckGo Instant Answer API.
 * Note: This API only returns results for well-known topics. For
 * production use, inject a better search function (Brave, SerpAPI, etc.)
 * via BuiltinToolConfig.webSearch.
 */
async function defaultDuckDuckGoSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Search provider redirect was blocked');
  }
  if (!response.ok) {
    throw new Error(`Search provider failed: ${response.status} ${response.statusText}`);
  }
  const data = JSON.parse(await readWebSearchTextWithLimit(response)) as {
    Abstract?: string;
    RelatedTopics?: Array<{ Text?: string }>;
  };

  const results: string[] = [];
  if (data.Abstract) results.push(data.Abstract);
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, 5)) {
      if (topic.Text) results.push(topic.Text);
    }
  }
  return results.length > 0 ? results.join('\n\n') : `No results found for: ${query}`;
}

export async function readWebSearchTextWithLimit(
  response: Response,
  maxBytes = WEB_SEARCH_MAX_BODY_BYTES,
): Promise<string> {
  return readBodyWithByteLimit(response, maxBytes, {
    tooLargeMessage: `Search provider response exceeds ${maxBytes} bytes`,
    cancelReason: 'search provider response too large',
    emptyBody: 'read-text',
  });
}

/**
 * Web search tool. Always available (desktop + browser).
 * Accepts an optional searchFn for DI; defaults to DuckDuckGo.
 */
export function createWebSearchTool(searchFn?: WebSearchFn): BuiltinTool {
  const doSearch = searchFn ?? defaultDuckDuckGoSearch;

  return {
    def: {
      name: 'web_search',
      description: 'Search the web for information. Returns search result snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    async execute(args) {
      const query = args.query as string;
      try {
        return await doSearch(query);
      } catch (err) {
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
