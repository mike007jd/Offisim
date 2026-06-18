import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentHost } from './build-agent-host-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-pi-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/pi-agent-host.mjs');
const NODE_OUTDIR = resolve(ROOT, 'apps/desktop/src-tauri/resources/node/bin');
const NODE_OUTFILE = resolve(NODE_OUTDIR, 'node');

async function copyNodeRuntime() {
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
  return NODE_OUTFILE;
}

await buildAgentHost({ root: ROOT, entry: ENTRY, outfile: OUTFILE });
const nodeRuntime = await copyNodeRuntime();

console.log(JSON.stringify({ ok: true, outfile: OUTFILE, nodeRuntime }, null, 2));
