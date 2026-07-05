#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');
const dmgDir = path.join(rootDir, 'apps/desktop/src-tauri/target/release/bundle/dmg');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
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

function requireEnv(env, key) {
  if (!env[key]) {
    console.error(`[release:dmg] missing ${key} in .env.local`);
    process.exit(1);
  }
}

function listDmgFiles() {
  if (!existsSync(dmgDir)) {
    return [];
  }

  return readdirSync(dmgDir)
    .filter((fileName) => fileName.endsWith('.dmg'))
    .map((fileName) => {
      const fullPath = path.join(dmgDir, fileName);
      return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function snapshotDmgFiles() {
  return new Map(listDmgFiles().map(({ fullPath, mtimeMs }) => [fullPath, mtimeMs]));
}

function findChangedDmg(previousDmgFiles) {
  return listDmgFiles().find(({ fullPath, mtimeMs }) => previousDmgFiles.get(fullPath) !== mtimeMs)
    ?.fullPath;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: buildEnv,
    encoding: 'utf8',
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

const localEnv = parseEnvFile(envPath);
const buildEnv = { ...process.env, ...localEnv };

if (!buildEnv.APPLE_PASSWORD && buildEnv.APPLE_APP_SPECIFIC_PASSWORD) {
  buildEnv.APPLE_PASSWORD = buildEnv.APPLE_APP_SPECIFIC_PASSWORD;
}

for (const key of ['APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID', 'APPLE_ID', 'APPLE_PASSWORD']) {
  requireEnv(buildEnv, key);
}

const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
  cwd: rootDir,
  encoding: 'utf8',
});

if (identities.status !== 0) {
  process.stderr.write(identities.stderr || identities.stdout);
  process.exit(identities.status ?? 1);
}

if (!identities.stdout.includes(`"${buildEnv.APPLE_SIGNING_IDENTITY}"`)) {
  console.error(
    `[release:dmg] signing identity not found in keychain: ${buildEnv.APPLE_SIGNING_IDENTITY}`,
  );
  process.exit(1);
}

const tauriConfig = JSON.stringify({
  bundle: {
    macOS: {
      signingIdentity: buildEnv.APPLE_SIGNING_IDENTITY,
    },
  },
});

console.log(`[release:dmg] using ${buildEnv.APPLE_SIGNING_IDENTITY}`);

const previousDmgFiles = snapshotDmgFiles();

const build = spawnSync(
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
    'dmg',
    '--config',
    tauriConfig,
  ],
  {
    cwd: rootDir,
    env: buildEnv,
    stdio: 'inherit',
  },
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const dmgArtifact = findChangedDmg(previousDmgFiles);

if (!dmgArtifact) {
  console.error(`[release:dmg] no new or updated DMG artifact found in ${dmgDir}`);
  process.exit(1);
}

console.log(`[release:dmg] notarizing final DMG ${dmgArtifact}`);

runChecked(
  'xcrun',
  [
    'notarytool',
    'submit',
    dmgArtifact,
    '--apple-id',
    buildEnv.APPLE_ID,
    '--team-id',
    buildEnv.APPLE_TEAM_ID,
    '--wait',
    '--timeout',
    '30m',
  ],
  {
    input: `${buildEnv.APPLE_PASSWORD}\n`,
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);

runChecked('xcrun', ['stapler', 'staple', dmgArtifact]);
runChecked('xcrun', ['stapler', 'validate', dmgArtifact]);

console.log(`[release:dmg] artifact ${dmgArtifact}`);
