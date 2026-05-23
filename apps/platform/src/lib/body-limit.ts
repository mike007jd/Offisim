import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

export const MAX_PLATFORM_JSON_BODY_BYTES = 64 * 1024;

export async function readJsonBodyWithLimit(
  c: Context<PlatformEnv>,
  maxBytes: number,
): Promise<unknown> {
  const contentLengthHeader = c.req.header('content-length')?.trim();
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new HTTPException(400, { message: 'Invalid content-length' });
    }
    if (contentLength > maxBytes) {
      throw new HTTPException(413, { message: 'Request body is too large' });
    }
  }

  const body = c.req.raw.body;
  if (!body) {
    throw new HTTPException(400, { message: 'Request body is required' });
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('request body too large');
        throw new HTTPException(413, { message: 'Request body is too large' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' });
  }
}

export function readPlatformJsonBody(c: Context<PlatformEnv>): Promise<unknown> {
  return readJsonBodyWithLimit(c, MAX_PLATFORM_JSON_BODY_BYTES);
}
