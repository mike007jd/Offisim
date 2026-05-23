import assert from 'node:assert/strict';
import {
  downloadRegistryArtifact,
  REGISTRY_ARTIFACT_MAX_BYTES,
  REGISTRY_ARTIFACT_TIMEOUT_MS,
} from '../packages/ui-office/src/lib/registry-artifact-download.ts';

const baseInfo = {
  package_version_id: 'pkgver_1',
  artifact_url: 'http://localhost:4100/v1/install/artifacts/pkgver_1',
  artifact_sha256: null,
  artifact_size_bytes: 4,
};
const trustedRegistryOrigin = { trustedOrigins: ['http://localhost:4100'] };

async function expectRejectsWithMessage(fn: () => Promise<unknown>, needle: string): Promise<void> {
  await assert.rejects(fn, (err) => err instanceof Error && err.message.includes(needle));
}

async function main(): Promise<void> {
  {
    const blob = await downloadRegistryArtifact(
      baseInfo,
      async (_url, init) => {
        assert.equal(init?.redirect, 'manual');
        assert.ok(init?.signal);
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        });
      },
      trustedRegistryOrigin,
    );
    assert.equal(blob.size, 4);
  }

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact({
        ...baseInfo,
        artifact_url: 'file:///tmp/package.offisimpkg',
      }),
    'Unsafe artifact URL protocol',
  );

  for (const artifact_url of [
    'http://cdn.example.test/package.offisimpkg',
    'https://cdn.example.test/package.offisimpkg',
    'https://localhost:4100/package.offisimpkg',
    'https://127.0.0.1:4100/package.offisimpkg',
    'https://10.0.0.5/package.offisimpkg',
    'https://172.20.0.5/package.offisimpkg',
    'https://192.168.1.5/package.offisimpkg',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/computeMetadata/v1',
  ]) {
    await expectRejectsWithMessage(
      () =>
        downloadRegistryArtifact({
          ...baseInfo,
          artifact_url,
        }),
      'External artifact URL',
    );
  }

  {
    const blob = await downloadRegistryArtifact(
      {
        ...baseInfo,
        artifact_url: 'http://localhost:4100/v1/install/artifacts/pkgver_1',
      },
      async (_url, init) => {
        assert.equal(init?.redirect, 'manual');
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        });
      },
      trustedRegistryOrigin,
    );
    assert.equal(blob.size, 4);
  }

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact(
        baseInfo,
        async () => new Response('', { status: 302 }),
        trustedRegistryOrigin,
      ),
    'redirects are not allowed',
  );

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact(
        { ...baseInfo, artifact_size_bytes: REGISTRY_ARTIFACT_MAX_BYTES + 1 },
        async () => {
          throw new Error('fetch should not be called');
        },
        trustedRegistryOrigin,
      ),
    'maximum allowed size',
  );

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact(
        baseInfo,
        async () => {
          return new Response('', {
            status: 200,
            headers: { 'content-length': '5' },
          });
        },
        trustedRegistryOrigin,
      ),
    'exceeded declared artifact size',
  );

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact(
        baseInfo,
        async () => {
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-length': '3' },
          });
        },
        trustedRegistryOrigin,
      ),
    'does not match artifact metadata',
  );

  await expectRejectsWithMessage(
    () =>
      downloadRegistryArtifact(
        { ...baseInfo, artifact_size_bytes: null },
        async () =>
          ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            body: null,
            arrayBuffer: async () => new ArrayBuffer(0),
          }) as Response,
        trustedRegistryOrigin,
      ),
    'readable stream',
  );

  {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutScheduled = false;
    let timeoutCleared = false;
    globalThis.setTimeout = ((handler, timeout, ...args) => {
      assert.equal(timeout, REGISTRY_ARTIFACT_TIMEOUT_MS);
      timeoutScheduled = true;
      return originalSetTimeout(handler, 0, ...args);
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((timeoutId) => {
      timeoutCleared = true;
      return originalClearTimeout(timeoutId);
    }) as typeof globalThis.clearTimeout;
    try {
      await expectRejectsWithMessage(
        () =>
          downloadRegistryArtifact(
            baseInfo,
            async (_url, init) => {
              const signal = init?.signal;
              assert.ok(signal);
              return new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new Uint8Array([1]));
                    signal.addEventListener(
                      'abort',
                      () => controller.error(new DOMException('artifact body timed out', 'AbortError')),
                      { once: true },
                    );
                  },
                }),
                {
                  status: 200,
                  headers: { 'content-length': '4' },
                },
              );
            },
            trustedRegistryOrigin,
          ),
        'artifact body timed out',
      );
      assert.ok(timeoutScheduled);
      assert.ok(timeoutCleared);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  }
}

await main();
