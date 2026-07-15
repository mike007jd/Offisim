#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  DEFAULT_MANIFEST_PATH,
  defaultArchivePath,
  loadManifest,
  runCommand,
  verifyArchive,
  verifyBinary,
} from './check-codex-app-server-artifact.mjs';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_APP_PATH = resolve(
  ROOT,
  'apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app',
);

function configuredValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseCliArgs(argv) {
  const result = {
    appPath: resolve(configuredValue('OFFISIM_APP_PATH') ?? DEFAULT_APP_PATH),
    manifestPath: DEFAULT_MANIFEST_PATH,
    archivePath: undefined,
    identity: configuredValue('OFFISIM_CODE_SIGN_IDENTITY', 'APPLE_SIGNING_IDENTITY') ?? '-',
    distribution: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--distribution') {
      result.distribution = true;
      continue;
    }
    if (!['--app', '--manifest', '--archive', '--identity'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === '--app') {
      result.appPath = resolve(value);
    } else if (argument === '--manifest') {
      result.manifestPath = resolve(value);
    } else if (argument === '--archive') {
      result.archivePath = resolve(value);
    } else {
      result.identity = value;
    }
    index += 1;
  }
  if (result.distribution && result.identity === '-') {
    throw new Error('distribution mode requires a non-ad-hoc signing identity');
  }
  return result;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function entitlementNames(codesignOutput) {
  return [...codesignOutput.matchAll(/<key>([^<]+)<\/key>/gu)].map((match) => match[1]).sort();
}

async function inspectSigning(targetPath) {
  const output = await runCommand('codesign', [
    '--display',
    '--verbose=4',
    '--entitlements',
    ':-',
    targetPath,
  ]);
  return {
    signature: output.match(/^Signature=(.+)$/mu)?.[1]?.trim() ?? 'unknown',
    teamIdentifier: output.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim() ?? 'not set',
    authorities: [...output.matchAll(/^Authority=(.+)$/gmu)].map((match) => match[1].trim()),
    flags: output.match(/^CodeDirectory .+ flags=(.+)$/mu)?.[1]?.trim() ?? 'unknown',
    entitlements: entitlementNames(output),
  };
}

function assertMainEntitlementsAreSafe(entitlements, forbiddenEntitlements) {
  const leaked = entitlements.filter((name) => forbiddenEntitlements.includes(name));
  if (leaked.length > 0) {
    throw new Error(
      `refusing to sign Offisim with sidecar-only entitlements on the main executable: ${leaked.join(', ')}`,
    );
  }
}

async function runCodesign(args) {
  try {
    await execFileAsync('codesign', args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error('codesign failed while sealing Offisim.app', { cause: error });
  }
}

async function executablePath(appPath) {
  const infoPlist = join(appPath, 'Contents/Info.plist');
  const executableName = (
    await runCommand('/usr/bin/plutil', [
      '-extract',
      'CFBundleExecutable',
      'raw',
      '-o',
      '-',
      infoPlist,
    ])
  ).trim();
  if (!executableName || basename(executableName) !== executableName) {
    throw new Error('CFBundleExecutable must be a single file name');
  }
  const mainExecutable = join(appPath, 'Contents/MacOS', executableName);
  const executableStat = await lstat(mainExecutable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
    throw new Error(`expected a regular non-symlink main executable: ${mainExecutable}`);
  }
  return mainExecutable;
}

async function assertDistributionIdentity(identity) {
  const output = await runCommand('security', ['find-identity', '-v', '-p', 'codesigning']);
  const matchingLine = output
    .split(/\r?\n/u)
    .find((line) => line.includes(identity) && line.includes('Developer ID Application:'));
  if (!matchingLine) {
    throw new Error('distribution signing identity is not an available Developer ID Application');
  }
}

async function assertAppBundle(appPath) {
  const appStat = await lstat(appPath);
  if (!appStat.isDirectory() || appStat.isSymbolicLink() || basename(appPath) !== 'Offisim.app') {
    throw new Error(`expected a non-symlink Offisim.app bundle: ${appPath}`);
  }
  const contentsPath = join(appPath, 'Contents');
  const contentsStat = await lstat(contentsPath);
  if (!contentsStat.isDirectory() || contentsStat.isSymbolicLink()) {
    throw new Error(`expected a non-symlink Contents directory: ${contentsPath}`);
  }
  const macOSPath = join(contentsPath, 'MacOS');
  const macOSStat = await lstat(macOSPath);
  if (!macOSStat.isDirectory() || macOSStat.isSymbolicLink()) {
    throw new Error(`expected a non-symlink Contents/MacOS directory: ${macOSPath}`);
  }
  return macOSPath;
}

async function extractPinnedBinary(archivePath, manifest) {
  await verifyArchive(archivePath, manifest);
  const extractionRoot = await mkdtemp(join(tmpdir(), 'offisim-codex-finalize-'));
  try {
    await runCommand('tar', ['-xzf', archivePath, '-C', extractionRoot]);
    const extractedPath = join(extractionRoot, manifest.binary.archiveEntry);
    await chmod(extractedPath, 0o755);
    const verifiedBinary = await verifyBinary(extractedPath, manifest);
    return {
      extractionRoot,
      extractedPath,
      sha256: verifiedBinary.sha256,
    };
  } catch (error) {
    await rm(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

async function restorePinnedSidecar(macOSPath, manifest, pinnedBinary) {
  const names = await readdir(macOSPath);
  const unexpectedSidecars = names.filter(
    (name) => name.startsWith(manifest.component) && name !== manifest.component,
  );
  if (unexpectedSidecars.length > 0) {
    throw new Error(
      `unexpected Codex sidecar names in Contents/MacOS: ${JSON.stringify(unexpectedSidecars)}`,
    );
  }

  const sidecarPath = join(macOSPath, manifest.component);
  try {
    const sidecarStat = await lstat(sidecarPath);
    if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) {
      throw new Error(`bundled sidecar must be a regular non-symlink file: ${sidecarPath}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const temporaryPath = join(macOSPath, `.${manifest.component}-${randomUUID()}.tmp`);
  try {
    await copyFile(pinnedBinary.extractedPath, temporaryPath, constants.COPYFILE_EXCL);
    await chmod(temporaryPath, 0o755);
    await verifyBinary(temporaryPath, manifest);
    const temporaryDigest = await sha256File(temporaryPath);
    if (temporaryDigest !== pinnedBinary.sha256 || temporaryDigest !== manifest.binary.sha256) {
      throw new Error('copied Codex sidecar differs from the pinned archive entry');
    }
    await rename(temporaryPath, sidecarPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  await verifyBinary(sidecarPath, manifest);
  const digest = await sha256File(sidecarPath);
  if (digest !== pinnedBinary.sha256 || digest !== manifest.binary.sha256) {
    throw new Error('restored Codex sidecar differs from the pinned archive entry');
  }
  return { sidecarPath, sha256: digest };
}

async function sealOuterApp(
  appPath,
  mainExecutable,
  identity,
  distribution,
  forbiddenEntitlements,
  before,
) {
  const codesignArgs = [
    '--force',
    '--sign',
    identity,
    '--options',
    'runtime',
    '--preserve-metadata=identifier,entitlements',
  ];
  if (distribution) {
    codesignArgs.push('--timestamp');
  }
  codesignArgs.push(appPath);
  await runCodesign(codesignArgs);
  await runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

  const after = await inspectSigning(mainExecutable);
  assertMainEntitlementsAreSafe(after.entitlements, forbiddenEntitlements);
  if (JSON.stringify(after.entitlements) !== JSON.stringify(before.entitlements)) {
    throw new Error('Offisim main executable entitlements changed while resealing the app bundle');
  }
  if (!after.flags.includes('runtime')) {
    throw new Error('Offisim main executable must retain hardened runtime');
  }
  if (distribution) {
    if (after.signature === 'adhoc' || after.teamIdentifier === 'not set') {
      throw new Error('distribution mode requires a non-ad-hoc app signature');
    }
    if (!after.authorities.some((authority) => authority.startsWith('Developer ID Application:'))) {
      throw new Error('distribution mode requires a Developer ID Application identity');
    }
  } else if (identity === '-' && after.signature !== 'adhoc') {
    throw new Error('local ad-hoc mode did not produce an ad-hoc app signature');
  }
  return after;
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Codex app-server bundle finalization requires macOS tooling');
  }

  const args = parseCliArgs(process.argv.slice(2));
  const { manifest, manifestPath } = await loadManifest(args.manifestPath);
  const archivePath = resolve(args.archivePath ?? defaultArchivePath(manifest));
  const macOSPath = await assertAppBundle(args.appPath);
  const mainExecutable = await executablePath(args.appPath);
  const initialMainSigning = await inspectSigning(mainExecutable);
  assertMainEntitlementsAreSafe(
    initialMainSigning.entitlements,
    manifest.binary.requiredEntitlements,
  );
  if (args.distribution) {
    await assertDistributionIdentity(args.identity);
  }
  const pinnedBinary = await extractPinnedBinary(archivePath, manifest);
  let restored;
  let mainSigning;
  try {
    restored = await restorePinnedSidecar(macOSPath, manifest, pinnedBinary);
    mainSigning = await sealOuterApp(
      args.appPath,
      mainExecutable,
      args.identity,
      args.distribution,
      manifest.binary.requiredEntitlements,
      initialMainSigning,
    );
  } finally {
    await rm(pinnedBinary.extractionRoot, { recursive: true, force: true });
  }

  const sidecarSigning = await inspectSigning(restored.sidecarPath);
  if (sidecarSigning.teamIdentifier !== manifest.binary.upstreamTeamIdentifier) {
    throw new Error('restored Codex sidecar lost its pinned upstream signature');
  }
  if (!sidecarSigning.flags.includes('runtime')) {
    throw new Error('restored Codex sidecar must retain hardened runtime');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.distribution ? 'distribution' : 'local',
        appPath: args.appPath,
        manifestPath,
        component: manifest.component,
        version: manifest.version,
        sidecar: {
          path: restored.sidecarPath,
          sha256: restored.sha256,
          teamIdentifier: sidecarSigning.teamIdentifier,
          entitlements: sidecarSigning.entitlements,
          hardenedRuntime: true,
        },
        app: {
          signing: args.distribution ? 'developer-id' : args.identity === '-' ? 'ad-hoc' : 'local',
          teamIdentifier:
            mainSigning.teamIdentifier === 'not set' ? undefined : mainSigning.teamIdentifier,
          entitlements: mainSigning.entitlements,
          hardenedRuntime: true,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[finalize-codex-app-server-bundle] ${error.message}`);
  process.exitCode = 1;
});
