import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
];

export const DEFAULT_MANIFEST_PATH = resolve(
  ROOT,
  'apps/desktop/src-tauri/binaries/codex-app-server.manifest.json',
);

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertEqual(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${field} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left, right) {
  const sortedLeft = sorted(left);
  const sortedRight = sorted(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

export async function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const absolutePath = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absolutePath, 'utf8'));

  assertEqual(manifest.schemaVersion, 2, 'schemaVersion');
  assertEqual(manifest.component, 'codex-app-server', 'component');
  const version = requireString(manifest.version, 'version');
  const releaseTag = requireString(manifest.releaseTag, 'releaseTag');
  assertEqual(releaseTag, `rust-v${version}`, 'releaseTag');
  const targetTriple = requireString(manifest.targetTriple, 'targetTriple');
  assertEqual(targetTriple, 'aarch64-apple-darwin', 'targetTriple');
  assertEqual(
    manifest.releaseUrl,
    `https://github.com/openai/codex/releases/tag/${releaseTag}`,
    'releaseUrl',
  );

  const expectedArchiveName = `codex-app-server-${targetTriple}.tar.gz`;
  assertEqual(manifest.archive?.fileName, expectedArchiveName, 'archive.fileName');
  assertEqual(
    manifest.archive?.url,
    `https://github.com/openai/codex/releases/download/${releaseTag}/${expectedArchiveName}`,
    'archive.url',
  );
  if (!Number.isSafeInteger(manifest.archive?.byteLength) || manifest.archive.byteLength <= 0) {
    throw new Error('archive.byteLength must be a positive safe integer');
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.archive?.sha256 ?? '')) {
    throw new Error('archive.sha256 must be a lowercase SHA-256 digest');
  }

  const expectedBinaryName = `codex-app-server-${targetTriple}`;
  assertEqual(manifest.binary?.archiveEntry, expectedBinaryName, 'binary.archiveEntry');
  assertEqual(manifest.binary?.outputFileName, expectedBinaryName, 'binary.outputFileName');
  if (!Number.isSafeInteger(manifest.binary?.byteLength) || manifest.binary.byteLength <= 0) {
    throw new Error('binary.byteLength must be a positive safe integer');
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.binary?.sha256 ?? '')) {
    throw new Error('binary.sha256 must be a lowercase SHA-256 digest');
  }
  assertEqual(manifest.binary?.architecture, 'arm64', 'binary.architecture');
  assertEqual(manifest.binary?.minimumMacOSVersion, '11.0', 'binary.minimumMacOSVersion');
  assertEqual(
    manifest.binary?.upstreamTeamIdentifier,
    '2DC432GLL2',
    'binary.upstreamTeamIdentifier',
  );
  if (
    !Array.isArray(manifest.binary?.requiredEntitlements) ||
    !sameStringSet(manifest.binary.requiredEntitlements, REQUIRED_ENTITLEMENTS)
  ) {
    throw new Error(
      `binary.requiredEntitlements must contain exactly ${REQUIRED_ENTITLEMENTS.join(', ')}`,
    );
  }
  assertEqual(manifest.license?.spdx, 'Apache-2.0', 'license.spdx');
  assertEqual(
    manifest.license?.sourceUrl,
    `https://raw.githubusercontent.com/openai/codex/${releaseTag}/LICENSE`,
    'license.sourceUrl',
  );
  assertEqual(
    manifest.license?.noticeSourceUrl,
    `https://raw.githubusercontent.com/openai/codex/${releaseTag}/NOTICE`,
    'license.noticeSourceUrl',
  );

  return { manifest, manifestPath: absolutePath };
}

export function defaultCacheRoot() {
  const configured = process.env.OFFISIM_ARTIFACT_CACHE?.trim();
  return configured
    ? resolve(configured)
    : join(homedir(), 'Library/Caches/Offisim/build-artifacts');
}

export function defaultArchivePath(manifest, cacheRoot = defaultCacheRoot()) {
  return join(
    resolve(cacheRoot),
    manifest.component,
    manifest.releaseTag,
    manifest.targetTriple,
    manifest.archive.fileName,
  );
}

export function defaultBinaryPath(manifest) {
  return resolve(ROOT, 'apps/desktop/src-tauri/binaries', manifest.binary.outputFileName);
}

export async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(
      `${command} ${args.join(' ')} failed${detail.length > 0 ? `:\n${detail}` : ''}`,
      { cause: error },
    );
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function normalizeArchiveEntry(entry) {
  return entry.startsWith('./') ? entry.slice(2) : entry;
}

function assertSafeArchiveEntry(entry) {
  if (entry.length === 0 || entry.includes('\0') || entry.startsWith('/')) {
    throw new Error(`archive contains an unsafe path: ${JSON.stringify(entry)}`);
  }
  const components = normalizeArchiveEntry(entry).split('/');
  if (components.some((component) => component === '' || component === '..')) {
    throw new Error(`archive contains an unsafe path: ${JSON.stringify(entry)}`);
  }
}

export async function verifyArchive(archivePath, manifest) {
  const absolutePath = resolve(archivePath);
  const archiveStat = await lstat(absolutePath);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
    throw new Error(`archive is not a regular non-symlink file: ${absolutePath}`);
  }
  assertEqual(archiveStat.size, manifest.archive.byteLength, 'downloaded archive byte length');

  const digest = await sha256File(absolutePath);
  assertEqual(digest, manifest.archive.sha256, 'downloaded archive SHA-256');

  const listing = await runCommand('tar', ['-tzf', absolutePath]);
  const entries = listing
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  entries.forEach(assertSafeArchiveEntry);
  if (entries.length !== 1 || normalizeArchiveEntry(entries[0]) !== manifest.binary.archiveEntry) {
    throw new Error(
      `archive must contain exactly ${manifest.binary.archiveEntry}; got ${JSON.stringify(entries)}`,
    );
  }

  const verboseListing = await runCommand('tar', ['-tvzf', absolutePath]);
  const firstEntry = verboseListing
    .split(/\r?\n/u)
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!firstEntry?.startsWith('-')) {
    throw new Error('archive entry must be a regular file, not a link or directory');
  }

  return {
    archivePath: absolutePath,
    byteLength: archiveStat.size,
    sha256: digest,
    entry: manifest.binary.archiveEntry,
  };
}

function minimumMacOSVersion(otoolOutput) {
  let currentCommand = '';
  for (const rawLine of otoolOutput.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith('cmd ')) {
      currentCommand = line.slice(4);
      continue;
    }
    if (currentCommand === 'LC_BUILD_VERSION' && line.startsWith('minos ')) {
      return line.slice(6).trim();
    }
    if (currentCommand === 'LC_VERSION_MIN_MACOSX' && line.startsWith('version ')) {
      return line.slice(8).trim();
    }
  }
  throw new Error('Mach-O does not declare a macOS minimum version');
}

function normalizedVersion(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length > 1 && parts.at(-1) === 0) {
    parts.pop();
  }
  return parts.join('.');
}

function parseEntitlements(codesignOutput) {
  const entitlements = new Map();
  const entryPattern = /<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/gu;
  for (const match of codesignOutput.matchAll(entryPattern)) {
    entitlements.set(match[1], match[2] === 'true');
  }
  return entitlements;
}

export async function verifyBinary(binaryPath, manifest) {
  if (process.platform !== 'darwin') {
    throw new Error('Codex app-server artifact verification requires macOS tooling');
  }

  const absolutePath = resolve(binaryPath);
  const binaryStat = await lstat(absolutePath);
  if (!binaryStat.isFile() || binaryStat.isSymbolicLink()) {
    throw new Error(`binary is not a regular non-symlink file: ${absolutePath}`);
  }
  if ((binaryStat.mode & 0o111) === 0) {
    throw new Error(`binary is not executable: ${absolutePath}`);
  }
  assertEqual(binaryStat.size, manifest.binary.byteLength, 'binary byte length');
  const digest = await sha256File(absolutePath);
  assertEqual(digest, manifest.binary.sha256, 'binary SHA-256');

  const fileDescription = (await runCommand('file', ['--brief', absolutePath])).trim();
  if (!fileDescription.includes('Mach-O 64-bit executable arm64')) {
    throw new Error(`expected a thin arm64 Mach-O executable, got: ${fileDescription}`);
  }

  const lipoOutput = await runCommand('lipo', ['-archs', absolutePath]);
  const architectures = [...new Set(lipoOutput.match(/\b(?:arm64|x86_64)\b/gu) ?? [])];
  if (architectures.length !== 1 || architectures[0] !== manifest.binary.architecture) {
    throw new Error(`expected only arm64 architecture, got: ${lipoOutput.trim()}`);
  }

  const otoolOutput = await runCommand('otool', ['-l', absolutePath]);
  const minOS = minimumMacOSVersion(otoolOutput);
  if (normalizedVersion(minOS) !== normalizedVersion(manifest.binary.minimumMacOSVersion)) {
    throw new Error(`expected macOS minimum ${manifest.binary.minimumMacOSVersion}, got ${minOS}`);
  }

  await runCommand('codesign', ['--verify', '--strict', '--verbose=2', absolutePath]);
  const signing = await runCommand('codesign', [
    '--display',
    '--verbose=4',
    '--entitlements',
    ':-',
    absolutePath,
  ]);
  const teamIdentifier = signing.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim();
  assertEqual(teamIdentifier, manifest.binary.upstreamTeamIdentifier, 'upstream TeamIdentifier');

  const entitlements = parseEntitlements(signing);
  const entitlementNames = [...entitlements.keys()];
  if (!sameStringSet(entitlementNames, manifest.binary.requiredEntitlements)) {
    throw new Error(
      `unexpected entitlements: expected ${JSON.stringify(sorted(manifest.binary.requiredEntitlements))}, got ${JSON.stringify(sorted(entitlementNames))}`,
    );
  }
  for (const name of manifest.binary.requiredEntitlements) {
    if (entitlements.get(name) !== true) {
      throw new Error(`required entitlement ${name} is not true`);
    }
  }

  return {
    binaryPath: absolutePath,
    byteLength: binaryStat.size,
    sha256: digest,
    architecture: manifest.binary.architecture,
    minimumMacOSVersion: minOS,
    teamIdentifier,
    entitlements: sorted(entitlementNames),
  };
}

function parseCliArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--manifest', '--archive', '--binary'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a path`);
    }
    result[argument.slice(2)] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const { manifest, manifestPath } = await loadManifest(args.manifest);
  const archivePath = resolve(args.archive ?? defaultArchivePath(manifest));
  const binaryPath = resolve(args.binary ?? defaultBinaryPath(manifest));
  const archive = await verifyArchive(archivePath, manifest);
  const binary = await verifyBinary(binaryPath, manifest);
  console.log(JSON.stringify({ ok: true, manifestPath, archive, binary }, null, 2));
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(`[check-codex-app-server-artifact] ${error.message}`);
    process.exitCode = 1;
  });
}
