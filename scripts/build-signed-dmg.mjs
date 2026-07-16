#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');
const targetTriple = 'aarch64-apple-darwin';
const appPath = path.join(
  rootDir,
  'apps/desktop/src-tauri/target',
  targetTriple,
  'release/bundle/macos/Offisim.app',
);
const dmgDir = path.join(
  rootDir,
  'apps/desktop/src-tauri/target',
  targetTriple,
  'release/bundle/dmg',
);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function requiredValue(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`missing ${key} in .env.local`);
  }
  return value;
}

function withoutAppleCredentials(env) {
  const result = { ...env };
  for (const key of [
    'APPLE_SIGNING_IDENTITY',
    'APPLE_TEAM_ID',
    'APPLE_ID',
    'APPLE_PASSWORD',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'OFFISIM_CODEX_MANIFEST',
    'OFFISIM_CODEX_ARCHIVE',
  ]) {
    delete result[key];
  }
  return result;
}

function writeCapturedOutput(result, { forwardStdout, forwardStderr }) {
  if (forwardStdout && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (forwardStderr && result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function runChecked(command, args, options = {}) {
  const {
    forwardStdout = true,
    forwardStderr = true,
    env = process.env,
    ...spawnOptions
  } = options;
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    encoding: 'utf8',
    ...spawnOptions,
  });

  writeCapturedOutput(result, { forwardStdout, forwardStderr });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with status ${result.status ?? 'unknown'}`);
  }
  return result;
}

function assertSigningIdentityAvailable(identity, env) {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    cwd: rootDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error('could not inspect code-signing identities in the keychain');
  }
  if (!result.stdout.includes(`"${identity}"`)) {
    throw new Error('configured code-signing identity is not available in the keychain');
  }
}

function assertDirectory(filePath, label) {
  const entry = lstatSync(filePath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

function assertRegularFile(filePath, label) {
  const entry = lstatSync(filePath);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0) {
    throw new Error(`${label} must be a non-empty regular non-symlink file`);
  }
  return entry;
}

function dmgArtifactName(version) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(version)) {
    throw new Error('CFBundleShortVersionString is unsafe for a DMG file name');
  }
  return `Offisim_${version}_aarch64.dmg`;
}

function readAppVersion(env) {
  const infoPlist = path.join(appPath, 'Contents/Info.plist');
  const result = runChecked(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      forwardStdout: false,
    },
  );
  return result.stdout.trim();
}

function assertOutputDirectory() {
  mkdirSync(dmgDir, { recursive: true });
  assertDirectory(dmgDir, 'DMG output directory');
}

function createDmgFromFinalizedApp(version, env) {
  assertOutputDirectory();
  const artifactName = dmgArtifactName(version);
  const finalDmgPath = path.join(dmgDir, artifactName);
  if (existsSync(finalDmgPath)) {
    assertRegularFile(finalDmgPath, 'existing DMG artifact');
  }

  const temporaryRoot = mkdtempSync(path.join(dmgDir, '.offisim-release-'));
  try {
    const stagingRoot = path.join(temporaryRoot, 'staging');
    const stagedAppPath = path.join(stagingRoot, 'Offisim.app');
    const temporaryDmgPath = path.join(temporaryRoot, artifactName);
    mkdirSync(stagingRoot, { recursive: false });

    runChecked('/usr/bin/ditto', [appPath, stagedAppPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assertDirectory(stagedAppPath, 'staged Offisim.app');
    symlinkSync('/Applications', path.join(stagingRoot, 'Applications'), 'dir');

    runChecked(
      'hdiutil',
      [
        'create',
        '-volname',
        'Offisim',
        '-srcfolder',
        stagingRoot,
        '-format',
        'UDZO',
        temporaryDmgPath,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assertRegularFile(temporaryDmgPath, 'generated DMG artifact');
    runChecked('hdiutil', ['verify', temporaryDmgPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { artifactName, finalDmgPath, temporaryDmgPath, temporaryRoot };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function notarizeAndPublishDmg(dmg, env, credentials) {
  try {
    console.log(`[release:dmg] notarizing ${dmg.artifactName}`);
    runChecked(
      'xcrun',
      [
        'notarytool',
        'submit',
        dmg.temporaryDmgPath,
        '--apple-id',
        credentials.appleId,
        '--team-id',
        credentials.teamId,
        '--wait',
        '--timeout',
        '30m',
      ],
      {
        env,
        input: `${credentials.password}\n`,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    runChecked('xcrun', ['stapler', 'staple', dmg.temporaryDmgPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runChecked('xcrun', ['stapler', 'validate', dmg.temporaryDmgPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    renameSync(dmg.temporaryDmgPath, dmg.finalDmgPath);
    assertRegularFile(dmg.finalDmgPath, 'published DMG artifact');
  } finally {
    rmSync(dmg.temporaryRoot, { recursive: true, force: true });
  }
}

function loadReleaseConfiguration() {
  const localEnv = parseEnvFile(envPath);
  const env = { ...process.env, ...localEnv };
  if (!env.APPLE_PASSWORD && env.APPLE_APP_SPECIFIC_PASSWORD) {
    env.APPLE_PASSWORD = env.APPLE_APP_SPECIFIC_PASSWORD;
  }
  return {
    env,
    identity: requiredValue(env, 'APPLE_SIGNING_IDENTITY'),
    credentials: {
      teamId: requiredValue(env, 'APPLE_TEAM_ID'),
      appleId: requiredValue(env, 'APPLE_ID'),
      password: requiredValue(env, 'APPLE_PASSWORD'),
    },
  };
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('release DMG packaging requires macOS tooling');
  }

  const configuration = loadReleaseConfiguration();
  const credentialFreeEnv = withoutAppleCredentials(configuration.env);
  assertSigningIdentityAvailable(configuration.identity, credentialFreeEnv);

  console.log('[release:dmg] building arm64 Offisim.app');
  runChecked(
    'npx',
    [
      '--yes',
      'pnpm@10.15.1',
      '--filter',
      '@offisim/desktop',
      'exec',
      'tauri',
      'build',
      '--bundles',
      'app',
      '--target',
      targetTriple,
    ],
    { env: credentialFreeEnv, stdio: 'inherit' },
  );
  assertDirectory(appPath, 'built Offisim.app');

  console.log('[release:dmg] signing Offisim.app');
  runChecked(
    'codesign',
    [
      '--force',
      '--deep',
      '--options',
      'runtime',
      '--timestamp',
      '--sign',
      configuration.identity,
      appPath,
    ],
    {
      env: credentialFreeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      forwardStdout: false,
    },
  );

  console.log('[release:dmg] verifying signed distribution app');
  runChecked('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    env: credentialFreeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    forwardStdout: false,
  });

  const version = readAppVersion(credentialFreeEnv);
  const dmg = createDmgFromFinalizedApp(version, credentialFreeEnv);
  notarizeAndPublishDmg(dmg, credentialFreeEnv, configuration.credentials);
  console.log(`[release:dmg] artifact ${dmg.finalDmgPath}`);
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  main().catch((error) => {
    console.error(`[release:dmg] ${error.message}`);
    process.exitCode = 1;
  });
}
