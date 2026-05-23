import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  GITHUB_TARBALL_MAX_BYTES,
  resolveGitSource,
} from '../packages/core/src/skills/skill-source-resolvers/git.ts';

const oversizedByHeader = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-length' ? String(GITHUB_TARBALL_MAX_BYTES + 1) : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  },
);
assert.equal(oversizedByHeader.kind, 'git-fetch-failed');
assert.match(oversizedByHeader.message, /exceeds/u);

const noStreamBody = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  },
);
assert.equal(noStreamBody.kind, 'git-fetch-failed');
assert.match(noStreamBody.message, /readable stream/u);

const oversizedByBody = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () =>
      toGitFetchResponse(new Response(new Uint8Array(GITHUB_TARBALL_MAX_BYTES + 1))),
  },
);
assert.equal(oversizedByBody.kind, 'git-fetch-failed');
assert.match(oversizedByBody.message, /exceeds/u);

const validTarball = gzipSync(
  createTar({
    'repo-main/smoke-skill/SKILL.md': [
      '---',
      'name: smoke-skill',
      'description: Web GitHub tarball security harness',
      '---',
      '# Smoke Skill',
    ].join('\n'),
  }),
);

const valid = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () =>
      toGitFetchResponse(
        new Response(validTarball, {
          headers: { 'content-length': String(validTarball.byteLength) },
        }),
      ),
  },
);
assert.equal('kind' in valid, false, JSON.stringify(valid));
assert.equal(valid.scan.skillMdPath, 'smoke-skill/SKILL.md');

const rendererTarballSource = readFileSync(
  new URL('../apps/desktop/renderer/src/lib/github-tarball.ts', import.meta.url),
  'utf8',
);
assert.match(rendererTarballSource, /GITHUB_TARBALL_MAX_BYTES/u);
assert.match(rendererTarballSource, /resp\.body\.getReader\(\)/u);
assert.equal(
  rendererTarballSource.includes('resp.arrayBuffer()'),
  false,
  'renderer GitHub tarball helper must not use uncapped arrayBuffer()',
);

console.log('Git source security harness passed.');

function toGitFetchResponse(response: Response) {
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body,
    arrayBuffer: () => response.arrayBuffer(),
  };
}

function createTar(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    chunks.push(tarHeader(name, body.byteLength));
    chunks.push(body);
    const padding = (512 - (body.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}
