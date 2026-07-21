import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  GITHUB_TARBALL_MAX_BYTES,
  resolveGitSource,
} from '../packages/core/src/skills/skill-source-resolvers/git.ts';
import { resolveUploadSource } from '../packages/core/src/skills/skill-source-resolvers/upload.ts';

const oversizedByHeader = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name) => (name === 'content-length' ? String(GITHUB_TARBALL_MAX_BYTES + 1) : null),
      },
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

const longUploadDir = `${'long-upload-skill-'.repeat(7)}root`;
const longUploadTar = createTarWithGnuLongName({
  [`${longUploadDir}/SKILL.md`]: [
    '---',
    'name: long-upload-skill',
    'description: Uploaded tarball long path harness',
    '---',
    '# Long Upload Skill',
  ].join('\n'),
});
const longUpload = resolveUploadSource({
  filename: 'long-upload-skill.tar',
  bytes: longUploadTar,
});
assert.equal('kind' in longUpload, false, JSON.stringify(longUpload));
assert.equal(longUpload.scan.skillMdPath, `${longUploadDir}/SKILL.md`);

const paxUploadDir = `pax-${'技能'.repeat(40)}`;
const paxUpload = resolveUploadSource({
  filename: 'pax-upload-skill.tar',
  bytes: createTarWithPaxRecords(
    [
      ['comment', 'line one\nline two'],
      ['path', `${paxUploadDir}/SKILL.md`],
    ],
    'pax-placeholder',
    [
      '---',
      'name: pax-upload-skill',
      'description: PAX UTF-8 path harness',
      '---',
      '# PAX Upload Skill',
    ].join('\n'),
  ),
});
assert.equal('kind' in paxUpload, false, JSON.stringify(paxUpload));
assert.equal(paxUpload.scan.skillMdPath, `${paxUploadDir}/SKILL.md`);

const oversizedPaxRecord = resolveUploadSource({
  filename: 'oversized-pax-record.tar',
  bytes: createTarWithPaxRecords([['comment', 'x'.repeat(64 * 1024)]], 'SKILL.md', '# unreachable'),
});
assert.equal(oversizedPaxRecord.kind, 'upload-unsupported-format');
assert.match(oversizedPaxRecord.message, /PAX record exceeds/u);

const oversizedPaxTotal = resolveUploadSource({
  filename: 'oversized-pax-total.tar',
  bytes: createTarWithPaxRecords(
    Array.from(
      { length: 18 },
      (_, index) => [`offisim.comment.${index}`, 'x'.repeat(60 * 1024)] as const,
    ),
    'SKILL.md',
    '# unreachable',
  ),
});
assert.equal(oversizedPaxTotal.kind, 'upload-unsupported-format');
assert.match(oversizedPaxTotal.message, /PAX extended headers exceed/u);

const adversarialPaxLength = resolveUploadSource({
  filename: 'adversarial-pax-length.tar',
  bytes: createTarWithRawPaxBody(
    Buffer.from(`${'0'.repeat(200_000)} path=SKILL.md\n`, 'ascii'),
    'SKILL.md',
    '# unreachable',
  ),
});
assert.equal(adversarialPaxLength.kind, 'upload-unsupported-format');
assert.match(adversarialPaxLength.message, /PAX record length/u);

const unsafeUpload = resolveUploadSource({
  filename: 'unsafe-upload-skill.tar',
  bytes: createTar({
    '../SKILL.md': [
      '---',
      'name: unsafe-upload-skill',
      'description: Traversal upload tarball harness',
      '---',
      '# Unsafe Upload Skill',
    ].join('\n'),
  }),
});
assert.equal(unsafeUpload.kind, 'upload-unsupported-format');
assert.match(unsafeUpload.message, /Unsafe archive entry path/u);

const unsafeZipUpload = resolveUploadSource({
  filename: 'unsafe-upload-skill.zip',
  bytes: createZip({
    '../SKILL.md': [
      '---',
      'name: unsafe-zip-upload-skill',
      'description: Traversal upload zip harness',
      '---',
      '# Unsafe Zip Upload Skill',
    ].join('\n'),
  }),
});
assert.equal(unsafeZipUpload.kind, 'upload-unsupported-format');
assert.match(unsafeZipUpload.message, /Unsafe archive entry path/u);

const unsafeGitTarball = gzipSync(
  createTar({
    'repo-main/../SKILL.md': [
      '---',
      'name: unsafe-git-skill',
      'description: Traversal GitHub tarball harness',
      '---',
      '# Unsafe Git Skill',
    ].join('\n'),
  }),
);
const unsafeGit = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () =>
      toGitFetchResponse(
        new Response(unsafeGitTarball, {
          headers: { 'content-length': String(unsafeGitTarball.byteLength) },
        }),
      ),
  },
);
assert.equal(unsafeGit.kind, 'git-fetch-failed');
assert.match(unsafeGit.message, /Unsafe archive entry path/u);

const unsafeAbsoluteGitTarball = gzipSync(
  createTar({
    '/tmp/SKILL.md': [
      '---',
      'name: unsafe-absolute-git-skill',
      'description: Absolute tarball path harness',
      '---',
      '# Unsafe Absolute Git Skill',
    ].join('\n'),
  }),
);
const unsafeAbsoluteGit = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () =>
      toGitFetchResponse(
        new Response(unsafeAbsoluteGitTarball, {
          headers: { 'content-length': String(unsafeAbsoluteGitTarball.byteLength) },
        }),
      ),
  },
);
assert.equal(unsafeAbsoluteGit.kind, 'git-fetch-failed');
assert.match(unsafeAbsoluteGit.message, /Unsafe archive entry path/u);

const unsafeDriveGitTarball = gzipSync(
  createTar({
    'C:/tmp/SKILL.md': [
      '---',
      'name: unsafe-drive-git-skill',
      'description: Windows drive tarball path harness',
      '---',
      '# Unsafe Drive Git Skill',
    ].join('\n'),
  }),
);
const unsafeDriveGit = await resolveGitSource(
  { url: 'https://github.com/offisim/security-skill' },
  {
    runtime: 'web',
    httpFetch: async () =>
      toGitFetchResponse(
        new Response(unsafeDriveGitTarball, {
          headers: { 'content-length': String(unsafeDriveGitTarball.byteLength) },
        }),
      ),
  },
);
assert.equal(unsafeDriveGit.kind, 'git-fetch-failed');
assert.match(unsafeDriveGit.message, /Unsafe archive entry path/u);

// Source-text belt-and-suspenders over the real owner of the GitHub tarball
// download. The former renderer helper (apps/desktop/renderer/src/lib/
// github-tarball.ts) was removed with the legacy UI framework in fc5f08ec; the
// byte-cap + streaming-read + zip-bomb guard now live solely in the core git
// resolver, which the behavioral scenarios above already exercise. We re-point
// the static assertion there so a future edit that drops the cap or buffers the
// whole tarball still trips this harness.
const gitResolverSource = readFileSync(
  new URL('../packages/core/src/skills/skill-source-resolvers/git.ts', import.meta.url),
  'utf8',
);
assert.match(gitResolverSource, /GITHUB_TARBALL_MAX_BYTES/u);
assert.match(
  gitResolverSource,
  /readGitTarballBytesWithLimit\(\s*resp,\s*GITHUB_TARBALL_MAX_BYTES\s*\)/u,
  'git resolver must read the tarball body through the byte-capped streaming reader',
);
assert.match(gitResolverSource, /resp\.body\.getReader\(\)/u);
assert.match(
  gitResolverSource,
  /safeGunzipSync/u,
  'git resolver must gunzip through the zip-bomb-guarded helper',
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

function createTarWithGnuLongName(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const longNameBody = Buffer.from(`${name}\0`, 'utf8');
    chunks.push(tarHeader('././@LongLink', longNameBody.byteLength, 'L'));
    chunks.push(longNameBody);
    const longNamePadding = (512 - (longNameBody.byteLength % 512)) % 512;
    if (longNamePadding > 0) chunks.push(Buffer.alloc(longNamePadding));

    const body = Buffer.from(content);
    chunks.push(tarHeader(name.slice(0, 100), body.byteLength));
    chunks.push(body);
    const padding = (512 - (body.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createTarWithPaxRecords(
  records: ReadonlyArray<readonly [keyword: string, value: string]>,
  name: string,
  content: string,
): Buffer {
  return createTarWithRawPaxBody(
    Buffer.concat(records.map(([keyword, value]) => paxRecord(keyword, value))),
    name,
    content,
  );
}

function createTarWithRawPaxBody(paxBody: Buffer, name: string, content: string): Buffer {
  const body = Buffer.from(content);
  const paxPadding = (512 - (paxBody.byteLength % 512)) % 512;
  const bodyPadding = (512 - (body.byteLength % 512)) % 512;
  return Buffer.concat([
    tarHeader('PaxHeader', paxBody.byteLength, 'x'),
    paxBody,
    Buffer.alloc(paxPadding),
    tarHeader(name, body.byteLength),
    body,
    Buffer.alloc(bodyPadding),
    Buffer.alloc(1024),
  ]);
}

function paxRecord(keyword: string, value: string): Buffer {
  const payload = Buffer.from(` ${keyword}=${value}\n`, 'utf8');
  let length = payload.byteLength + 1;
  for (;;) {
    const nextLength = payload.byteLength + String(length).length;
    if (nextLength === length) return Buffer.concat([Buffer.from(String(length)), payload]);
    length = nextLength;
  }
}

function createZip(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = Buffer.from(content);
    const crc = crc32(body);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.byteLength, 18);
    localHeader.writeUInt32LE(body.byteLength, 22);
    localHeader.writeUInt16LE(nameBytes.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.byteLength, 20);
    centralHeader.writeUInt32LE(body.byteLength, 24);
    centralHeader.writeUInt16LE(nameBytes.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 34);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.byteLength + nameBytes.byteLength + body.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function tarHeader(name: string, size: number, type = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}
