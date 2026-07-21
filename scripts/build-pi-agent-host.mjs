import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentHost } from './build-agent-host-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-pi-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/pi-agent-host.mjs');
const NODE_OUTDIR = resolve(ROOT, 'apps/desktop/src-tauri/resources/node/bin');
const NODE_OUTFILE = resolve(NODE_OUTDIR, 'node');
const NODE_RELEASE_ENTITLEMENTS = resolve(
  ROOT,
  'apps/desktop/src-tauri/entitlements/node-release.plist',
);

function signNodeRuntimeForDistribution(pathname) {
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (process.platform !== 'darwin' || !identity) return;
  const result = spawnSync(
    '/usr/bin/codesign',
    [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      NODE_RELEASE_ENTITLEMENTS,
      '--sign',
      identity,
      pathname,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Failed to sign bundled Node for distribution: ${result.stderr?.trim() || result.error?.message || `exit ${result.status}`}`,
    );
  }
}

async function copyNodeRuntime() {
  const requiredVersion = (await readFile(resolve(ROOT, '.nvmrc'), 'utf8')).trim();
  if (process.version !== `v${requiredVersion}`) {
    throw new Error(
      `Bundled Node must be built with v${requiredVersion}; found ${process.version}. Use the repository .nvmrc before building Offisim.app.`,
    );
  }
  const source = process.execPath;
  if (resolve(source) === NODE_OUTFILE) {
    return NODE_OUTFILE;
  }
  await rm(resolve(ROOT, 'apps/desktop/src-tauri/resources/node'), {
    recursive: true,
    force: true,
  });
  await mkdir(NODE_OUTDIR, { recursive: true });
  await copyFile(source, NODE_OUTFILE);
  await chmod(NODE_OUTFILE, 0o755);
  signNodeRuntimeForDistribution(NODE_OUTFILE);
  return NODE_OUTFILE;
}

const nodeRuntime = await copyNodeRuntime();
await buildAgentHost({ root: ROOT, entry: ENTRY, outfile: OUTFILE });

console.log(JSON.stringify({ ok: true, outfile: OUTFILE, nodeRuntime }, null, 2));
