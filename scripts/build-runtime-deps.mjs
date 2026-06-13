// Builds the Node runtime dependency packages that the desktop `.app` bundles,
// in dependency order. Run as the `build:runtime-deps` step of the desktop
// `build:frontend` chain.
//
// Formerly imported `ensureRuntimeBuild` from the (deleted) `harness-lib.mjs`;
// inlined here so the build does not depend on the erased test infrastructure.
//
// Always a clean build: the `.app` ships these dist artifacts, so stale
// incremental output must never leak into a release — clear each package's
// tsbuildinfo, then build in order.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Ordered: asset-schema → shared-types → install-core → db-local → doc-engine → core.
const RUNTIME_PACKAGES = [
  { dir: 'asset-schema', pkg: '@offisim/asset-schema' },
  { dir: 'shared-types', pkg: '@offisim/shared-types' },
  { dir: 'install-core', pkg: '@offisim/install-core' },
  { dir: 'db-local', pkg: '@offisim/db-local' },
  { dir: 'doc-engine', pkg: '@offisim/doc-engine' },
  { dir: 'core', pkg: '@offisim/core' },
];

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

for (const { dir } of RUNTIME_PACKAGES) {
  rmSync(resolve(ROOT, 'packages', dir, 'tsconfig.tsbuildinfo'), { force: true });
}
for (const { pkg } of RUNTIME_PACKAGES) {
  await run('pnpm', ['--filter', pkg, 'build']);
}
console.log(JSON.stringify({ ok: true, built: RUNTIME_PACKAGES.map((p) => p.pkg) }, null, 2));
