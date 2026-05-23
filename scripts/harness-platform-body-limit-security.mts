import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_PLATFORM_JSON_BODY_BYTES,
  readJsonBodyWithLimit,
  readPlatformJsonBody,
} from '../apps/platform/src/lib/body-limit.js';

function makeContext(input: { body?: string; headers?: Record<string, string> }) {
  const request = new Request('https://platform.example.test/body-limit', {
    method: 'POST',
    body: input.body,
    headers: input.headers,
  });
  return {
    req: {
      raw: request,
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
  } as never;
}

async function expectHttpStatus(fn: () => Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(
    fn,
    (err) =>
      err instanceof Error &&
      'status' in err &&
      typeof err.status === 'number' &&
      err.status === status,
    `expected HTTP ${status}`,
  );
}

function expectRoutesDoNotBypassBodyLimit(): void {
  const routeDir = new URL('../apps/platform/src/routes', import.meta.url);
  for (const entry of readdirSync(routeDir)) {
    if (!entry.endsWith('.ts')) continue;
    const filePath = join(routeDir.pathname, entry);
    const source = readFileSync(filePath, 'utf8');
    if (/\bc\.req\.json\s*\(/.test(source)) {
      throw new Error(`${entry} still calls c.req.json() directly`);
    }
  }
}

async function main(): Promise<void> {
  assert.deepEqual(await readPlatformJsonBody(makeContext({ body: '{"ok":true}' })), {
    ok: true,
  });

  await expectHttpStatus(
    () =>
      readJsonBodyWithLimit(
        makeContext({
          body: '{}',
          headers: { 'content-length': String(MAX_PLATFORM_JSON_BODY_BYTES + 1) },
        }),
        MAX_PLATFORM_JSON_BODY_BYTES,
      ),
    413,
  );

  await expectHttpStatus(
    () =>
      readJsonBodyWithLimit(
        makeContext({ body: JSON.stringify({ value: 'x'.repeat(MAX_PLATFORM_JSON_BODY_BYTES) }) }),
        MAX_PLATFORM_JSON_BODY_BYTES,
      ),
    413,
  );

  await expectHttpStatus(() => readPlatformJsonBody(makeContext({ body: '{' })), 400);
  await expectHttpStatus(() => readPlatformJsonBody(makeContext({})), 400);
  expectRoutesDoNotBypassBodyLimit();
}

await main();
