import type { BuiltinTool } from './types.js';

export function createWebFetchTool(): BuiltinTool {
  return {
    def: {
      name: 'web_fetch',
      description: 'Fetch a URL and return text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
      maxResultSizeChars: 30_000,
    },
    async execute(args) {
      const url = new URL(args.url as string);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('[WEB_FETCH_URL_DENIED] Only http and https URLs are allowed.');
      }
      const response = await fetch(url, { redirect: 'follow' });
      const text = await response.text();
      if (!response.ok)
        throw new Error(`[WEB_FETCH_FAILED] ${response.status} ${text.slice(0, 500)}`);
      return text;
    },
  };
}
