// Builds the Node runtime dependency packages that the desktop `.app` bundles
// (asset-schema → shared-types → install-core → db-local → doc-engine → core).
// Run as the `build:runtime-deps` step of the desktop `build:frontend` chain.
//
// Formerly imported `ensureRuntimeBuild` from the (deleted) `harness-lib.mjs`;
// inlined here so the build does not depend on the erased test infrastructure.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const REQUIRED_BUILD_ARTIFACTS = [
  'packages/asset-schema/dist/index.js',
  'packages/shared-types/dist/index.js',
  'packages/install-core/dist/index.js',
  'packages/db-local/dist/index.js',
  'packages/doc-engine/dist/index.js',
  'packages/core/dist/index.js',
];

const RUNTIME_BUILD_PACKAGES = [
  '@offisim/asset-schema',
  '@offisim/shared-types',
  '@offisim/install-core',
  '@offisim/db-local',
  '@offisim/doc-engine',
  '@offisim/core',
];

function rootPath(...parts) {
  return resolve(ROOT, ...parts);
}

function pathExists(path) {
  return existsSync(rootPath(path));
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          signal
            ? `${command} ${args.join(' ')} exited via signal ${signal}`
            : `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`,
        ),
      );
    });
    child.on('error', rejectPromise);
  });
}

function clearIncrementalState() {
  for (const pkg of ['asset-schema', 'shared-types', 'install-core', 'db-local', 'doc-engine', 'core']) {
    rmSync(rootPath('packages', pkg, 'tsconfig.tsbuildinfo'), { force: true });
  }
}

async function ensureRuntimeBuild(options = {}) {
  const force = Boolean(options.force);
  const hasArtifacts = REQUIRED_BUILD_ARTIFACTS.every(pathExists);
  if (!force && hasArtifacts) return;
  clearIncrementalState();
  for (const pkg of RUNTIME_BUILD_PACKAGES) {
    await run('pnpm', ['--filter', pkg, 'build']);
  }
}

await ensureRuntimeBuild({ force: true });
console.log(JSON.stringify({ ok: true, built: RUNTIME_BUILD_PACKAGES }, null, 2));
