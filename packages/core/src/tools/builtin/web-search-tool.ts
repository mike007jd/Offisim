import type { BuiltinTool, WebSearchFn } from './types.js';

/**
 * Default search implementation using DuckDuckGo Instant Answer API.
 * Note: This API only returns results for well-known topics. For
 * production use, inject a better search function (Brave, SerpAPI, etc.)
 * via BuiltinToolConfig.webSearch.
 */
async function defaultDuckDuckGoSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const response = await fetch(url);
  const data = (await response.json()) as {
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
