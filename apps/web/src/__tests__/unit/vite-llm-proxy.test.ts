import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../../vite.config';

type ProxyHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function getProxyHandler(): ProxyHandler {
  const plugin = (config.plugins ?? []).find(
    (
      candidate: unknown,
    ): candidate is { name: string; configureServer: (server: unknown) => void } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'name' in candidate &&
      candidate.name === 'llm-proxy' &&
      'configureServer' in candidate &&
      typeof candidate.configureServer === 'function',
  );

  if (!plugin) {
    throw new Error('llm-proxy plugin not found');
  }

  let handler: ProxyHandler | null = null;
  plugin.configureServer({
    middlewares: {
      use(path: string, registered: ProxyHandler) {
        if (path === '/api/llm-proxy') {
          handler = registered;
        }
      },
    },
  });

  if (!handler) {
    throw new Error('llm-proxy middleware not registered');
  }

  return handler;
}

function createRequest(targetBase: string): IncomingMessage {
  return {
    headers: { 'x-llm-base-url': targetBase },
    method: 'POST',
    url: '/v1/messages',
    async *[Symbol.asyncIterator]() {},
  } as unknown as IncomingMessage;
}

function createResponse() {
  let statusCode: number | null = null;
  let endedBody = '';

  const response = {
    writeHead(code: number) {
      statusCode = code;
      return response;
    },
    end(body?: string) {
      endedBody += body ?? '';
      return response;
    },
    write(chunk?: Uint8Array | string) {
      if (typeof chunk === 'string') {
        endedBody += chunk;
      } else if (chunk) {
        endedBody += Buffer.from(chunk).toString('utf8');
      }
      return true;
    },
  } as unknown as ServerResponse;

  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return endedBody;
    },
  };
}

describe('llm-proxy middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows MiniMax anthropic-compatible proxy targets', async () => {
    const handler = getProxyHandler();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const req = createRequest('https://api.minimax.io/anthropic');
    const res = createResponse();

    await handler(req, res.response);

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(res.body).toBe('ok');
  });
});
