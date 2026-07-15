import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  runCommand,
  verifyBinary,
} from './check-codex-app-server-artifact.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_APP_PATH = resolve(
  ROOT,
  'apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app',
);
const SOURCE_NOTICES_ROOT = resolve(ROOT, 'apps/desktop/src-tauri/resources/third-party/codex');

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

function normalizedVersion(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  while (parts.length > 1 && parts.at(-1) === 0) {
    parts.pop();
  }
  return parts.join('.');
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

function parseSigning(codesignOutput) {
  const entitlementEntries = new Map();
  const entryPattern = /<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/gu;
  for (const match of codesignOutput.matchAll(entryPattern)) {
    entitlementEntries.set(match[1], match[2] === 'true');
  }
  return {
    signature: codesignOutput.match(/^Signature=(.+)$/mu)?.[1]?.trim() ?? 'unknown',
    teamIdentifier: codesignOutput.match(/^TeamIdentifier=(.+)$/mu)?.[1]?.trim() ?? 'not set',
    authorities: [...codesignOutput.matchAll(/^Authority=(.+)$/gmu)].map((match) =>
      match[1].trim(),
    ),
    flags: codesignOutput.match(/^CodeDirectory .+ flags=(.+)$/mu)?.[1]?.trim() ?? 'unknown',
    entitlements: entitlementEntries,
  };
}

async function inspectSigning(path) {
  await runCommand('codesign', ['--verify', '--strict', '--verbose=2', path]);
  const output = await runCommand('codesign', [
    '--display',
    '--verbose=4',
    '--entitlements',
    ':-',
    path,
  ]);
  return parseSigning(output);
}

async function inspectSidecar(sidecarPath, manifest) {
  const sidecarStat = await lstat(sidecarPath);
  if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) {
    throw new Error(`bundled app-server must be a regular non-symlink file: ${sidecarPath}`);
  }
  if ((sidecarStat.mode & 0o111) === 0) {
    throw new Error(`bundled app-server is not executable: ${sidecarPath}`);
  }
  const verifiedArtifact = await verifyBinary(sidecarPath, manifest);

  const fileDescription = (await runCommand('file', ['--brief', sidecarPath])).trim();
  if (!fileDescription.includes('Mach-O 64-bit executable arm64')) {
    throw new Error(`bundled app-server is not a thin arm64 Mach-O: ${fileDescription}`);
  }
  const lipoOutput = await runCommand('lipo', ['-archs', sidecarPath]);
  const architectures = [...new Set(lipoOutput.match(/\b(?:arm64|x86_64)\b/gu) ?? [])];
  if (architectures.length !== 1 || architectures[0] !== manifest.binary.architecture) {
    throw new Error(`bundled app-server has unexpected architectures: ${lipoOutput.trim()}`);
  }

  const minOS = minimumMacOSVersion(await runCommand('otool', ['-l', sidecarPath]));
  if (normalizedVersion(minOS) !== normalizedVersion(manifest.binary.minimumMacOSVersion)) {
    throw new Error(
      `bundled app-server requires macOS ${minOS}; expected ${manifest.binary.minimumMacOSVersion}`,
    );
  }

  const signing = await inspectSigning(sidecarPath);
  if (
    signing.signature === 'adhoc' ||
    signing.teamIdentifier !== manifest.binary.upstreamTeamIdentifier
  ) {
    throw new Error(
      `bundled app-server must retain the pinned upstream signature; expected TeamIdentifier=${manifest.binary.upstreamTeamIdentifier}, got signature=${signing.signature}, TeamIdentifier=${signing.teamIdentifier}`,
    );
  }
  const entitlementNames = [...signing.entitlements.keys()];
  if (!sameStringSet(entitlementNames, manifest.binary.requiredEntitlements)) {
    throw new Error(
      [
        'bundled app-server entitlements changed during packaging',
        `expected=${JSON.stringify(sorted(manifest.binary.requiredEntitlements))}`,
        `actual=${JSON.stringify(sorted(entitlementNames))}`,
        'Tauri macOS configuration has only one global entitlements path, so the fix belongs in the nested-code signing phase rather than granting these entitlements to the main app.',
      ].join('; '),
    );
  }
  for (const name of manifest.binary.requiredEntitlements) {
    if (signing.entitlements.get(name) !== true) {
      throw new Error(`bundled app-server entitlement ${name} is not true`);
    }
  }
  if (signing.entitlements.has('com.apple.security.get-task-allow')) {
    throw new Error('bundled app-server must not have com.apple.security.get-task-allow');
  }

  return {
    path: sidecarPath,
    byteLength: sidecarStat.size,
    sha256: verifiedArtifact.sha256,
    architecture: manifest.binary.architecture,
    minimumMacOSVersion: minOS,
    signature: signing.signature,
    teamIdentifier: signing.teamIdentifier,
    authorities: signing.authorities,
    flags: signing.flags,
    entitlements: sorted(entitlementNames),
  };
}

async function assertNotices(appPath) {
  const bundledNoticesRoot = join(appPath, 'Contents/Resources/resources/third-party/codex');
  const results = [];
  for (const fileName of ['LICENSE', 'NOTICE']) {
    const sourcePath = join(SOURCE_NOTICES_ROOT, fileName);
    const bundledPath = join(bundledNoticesRoot, fileName);
    const [source, bundled] = await Promise.all([readFile(sourcePath), readFile(bundledPath)]);
    if (!source.equals(bundled)) {
      throw new Error(`bundled ${fileName} differs from the pinned source file`);
    }
    results.push({ fileName, path: bundledPath, byteLength: bundled.length });
  }
  return results;
}

function parseCliArgs(argv) {
  const result = { appPath: DEFAULT_APP_PATH, distribution: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--distribution') {
      result.distribution = true;
      continue;
    }
    if (argument !== '--app') {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--app requires a path');
    }
    result.appPath = resolve(value);
    index += 1;
  }
  return result;
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Codex app-server bundle verification requires macOS tooling');
  }

  const args = parseCliArgs(process.argv.slice(2));
  const appPath = resolve(args.appPath);
  const appStat = await lstat(appPath);
  if (!appStat.isDirectory() || basename(appPath) !== 'Offisim.app') {
    throw new Error(`expected an Offisim.app bundle: ${appPath}`);
  }

  const { manifest } = await loadManifest();
  const infoPlist = join(appPath, 'Contents/Info.plist');
  const appMinimumVersion = (
    await runCommand('/usr/bin/plutil', [
      '-extract',
      'LSMinimumSystemVersion',
      'raw',
      '-o',
      '-',
      infoPlist,
    ])
  ).trim();
  if (
    normalizedVersion(appMinimumVersion) !== normalizedVersion(manifest.binary.minimumMacOSVersion)
  ) {
    throw new Error(
      `Offisim.app LSMinimumSystemVersion must be ${manifest.binary.minimumMacOSVersion}, got ${appMinimumVersion}`,
    );
  }

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
  const mainExecutable = join(appPath, 'Contents/MacOS', executableName);
  const macOSFiles = await readdir(join(appPath, 'Contents/MacOS'));
  const bundledSidecars = macOSFiles.filter((name) => name.startsWith('codex-app-server'));
  if (bundledSidecars.length !== 1 || bundledSidecars[0] !== manifest.component) {
    throw new Error(
      `Tauri must strip the target suffix and bundle exactly Contents/MacOS/${manifest.component}; got ${JSON.stringify(bundledSidecars)}`,
    );
  }

  const sidecar = await inspectSidecar(
    join(appPath, 'Contents/MacOS', manifest.component),
    manifest,
  );
  const notices = await assertNotices(appPath);
  await runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const mainSigning = await inspectSigning(mainExecutable);

  if (mainSigning.entitlements.has('com.apple.security.get-task-allow')) {
    throw new Error('Offisim main executable must not have com.apple.security.get-task-allow');
  }
  const leakedSidecarEntitlements = manifest.binary.requiredEntitlements.filter((name) =>
    mainSigning.entitlements.has(name),
  );
  if (leakedSidecarEntitlements.length > 0) {
    throw new Error(
      `Offisim main executable must not inherit sidecar-only entitlements: ${leakedSidecarEntitlements.join(', ')}`,
    );
  }
  if (args.distribution) {
    if (sidecar.signature === 'adhoc' || mainSigning.signature === 'adhoc') {
      throw new Error('distribution mode rejects ad hoc signatures');
    }
    if (mainSigning.teamIdentifier === 'not set') {
      throw new Error(
        'distribution mode requires Offisim.app to have a Developer ID TeamIdentifier',
      );
    }
    if (
      !mainSigning.authorities.some((authority) =>
        authority.startsWith('Developer ID Application:'),
      )
    ) {
      throw new Error('distribution mode requires Offisim.app to use Developer ID Application');
    }
    if (!sidecar.flags.includes('runtime') || !mainSigning.flags.includes('runtime')) {
      throw new Error('distribution mode requires hardened runtime on app and sidecar');
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: args.distribution ? 'distribution' : 'local',
        appPath,
        appMinimumVersion,
        mainExecutable,
        mainSigning: {
          signature: mainSigning.signature,
          teamIdentifier: mainSigning.teamIdentifier,
          authorities: mainSigning.authorities,
          flags: mainSigning.flags,
          entitlements: sorted(mainSigning.entitlements.keys()),
        },
        sidecar,
        notices,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[check-codex-app-server-bundle] ${error.message}`);
  process.exitCode = 1;
});
