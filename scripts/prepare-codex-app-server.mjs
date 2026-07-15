import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DEFAULT_MANIFEST_PATH,
  defaultArchivePath,
  defaultBinaryPath,
  defaultCacheRoot,
  loadManifest,
  runCommand,
  verifyArchive,
  verifyBinary,
} from './check-codex-app-server-artifact.mjs';

function environmentFlag(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function parseCliArgs(argv) {
  const result = {
    offline: environmentFlag('OFFISIM_OFFLINE'),
    manifest: DEFAULT_MANIFEST_PATH,
    cacheRoot: defaultCacheRoot(),
    output: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--offline') {
      result.offline = true;
      continue;
    }
    if (!['--manifest', '--cache-root', '--output'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a path`);
    }
    result[argument === '--cache-root' ? 'cacheRoot' : argument.slice(2)] = resolve(value);
    index += 1;
  }
  return result;
}

async function downloadArchive(manifest, archivePath) {
  const temporaryPath = `${archivePath}.${randomUUID()}.download`;
  await mkdir(dirname(archivePath), { recursive: true });
  try {
    const response = await fetch(manifest.archive.url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'Offisim-Codex-App-Server-Preparer/1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`download failed with HTTP ${response.status} ${response.statusText}`);
    }
    const finalUrl = new URL(response.url);
    const allowedDownloadHosts = new Set([
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
    if (finalUrl.protocol !== 'https:' || !allowedDownloadHosts.has(finalUrl.hostname)) {
      throw new Error(`download redirected to an untrusted URL: ${response.url}`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== manifest.archive.byteLength) {
      throw new Error(
        `download Content-Length must be ${manifest.archive.byteLength}, got ${contentLength}`,
      );
    }

    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
    );
    await verifyArchive(temporaryPath, manifest);
    await rename(temporaryPath, archivePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function ensureArchive(manifest, archivePath, offline) {
  try {
    await verifyArchive(archivePath, manifest);
    return 'cache';
  } catch (cacheError) {
    if (offline) {
      throw new Error(
        `offline mode requires the exact verified archive at ${archivePath}: ${cacheError.message}`,
        { cause: cacheError },
      );
    }
    await rm(archivePath, { force: true });
  }

  await downloadArchive(manifest, archivePath);
  return 'download';
}

async function materializeBinary(manifest, archivePath, outputPath) {
  const extractionRoot = await mkdtemp(join(tmpdir(), 'offisim-codex-app-server-'));
  const temporaryOutput = join(dirname(outputPath), `.codex-app-server-${randomUUID()}.tmp`);
  try {
    await runCommand('tar', ['-xzf', archivePath, '-C', extractionRoot]);
    const extractedBinary = join(extractionRoot, manifest.binary.archiveEntry);
    await chmod(extractedBinary, 0o755);
    await verifyBinary(extractedBinary, manifest);

    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(extractedBinary, temporaryOutput);
    await chmod(temporaryOutput, 0o755);
    await verifyBinary(temporaryOutput, manifest);
    await rename(temporaryOutput, outputPath);
  } finally {
    await rm(temporaryOutput, { force: true });
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Codex app-server preparation requires macOS tooling');
  }

  const args = parseCliArgs(process.argv.slice(2));
  const { manifest, manifestPath } = await loadManifest(args.manifest);
  const archivePath = defaultArchivePath(manifest, args.cacheRoot);
  const outputPath = resolve(args.output ?? defaultBinaryPath(manifest));
  const source = await ensureArchive(manifest, archivePath, args.offline);
  await materializeBinary(manifest, archivePath, outputPath);
  const archive = await verifyArchive(archivePath, manifest);
  const binary = await verifyBinary(outputPath, manifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        offline: args.offline,
        source,
        manifestPath,
        archive,
        binary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[prepare-codex-app-server] ${error.message}`);
  process.exitCode = 1;
});
