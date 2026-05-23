import {
  SOP_SYNC_MAX_BODY_BYTES,
  SopSyncService,
  readSopSyncTextWithLimit,
  validateSopSyncUrl,
} from '../packages/core/src/services/sop-sync-service.ts';

for (const url of [
  'http://raw.example.com/sop.json',
  'https://localhost/sop.json',
  'https://127.0.0.1/sop.json',
  'https://10.0.0.4/sop.json',
  'https://169.254.169.254/latest/meta-data',
  'https://metadata.google.internal/computeMetadata/v1',
]) {
  expectThrows(() => validateSopSyncUrl(url), `SOP sync accepted denied URL: ${url}`);
}

await expectRejects(
  readSopSyncTextWithLimit(
    new Response('x'.repeat(SOP_SYNC_MAX_BODY_BYTES + 1), {
      headers: { 'content-length': String(SOP_SYNC_MAX_BODY_BYTES + 1) },
    }),
  ),
  'SOP sync accepted oversized response',
);

await expectRejects(
  readSopSyncTextWithLimit({
    headers: new Headers(),
    body: null,
    text: async () => 'x'.repeat(SOP_SYNC_MAX_BODY_BYTES + 1),
  } as Response),
  'SOP sync accepted oversized no-stream response',
);

const service = new SopSyncService({} as never);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () =>
    new Response('', {
      status: 302,
      headers: { Location: 'https://raw.example.com/final-sop.json' },
    })) as typeof fetch;
  await expectRejects(
    service.fetchRemoteSop('https://raw.example.com/sop.json'),
    'SOP sync accepted redirect response',
  );

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        sop_id: 'sop.remote',
        name: 'Remote SOP',
        description: 'Remote SOP import',
        steps: [],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  const sop = await service.fetchRemoteSop('https://raw.example.com/sop.json');
  if (sop.sop_id !== 'sop.remote' || sop.name !== 'Remote SOP') {
    throw new Error('SOP sync failed to parse valid HTTPS JSON response');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('SOP sync security harness passed.');

function expectThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

async function expectRejects(fn: Promise<unknown>, message: string): Promise<void> {
  try {
    await fn;
  } catch {
    return;
  }
  throw new Error(message);
}
