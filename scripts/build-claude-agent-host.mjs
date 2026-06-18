import { chmod, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentHost } from './build-agent-host-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-claude-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/claude-agent-host.mjs');
const NATIVE_OUTDIR = resolve(ROOT, 'apps/desktop/src-tauri/resources/claude-code-native');
const NATIVE_OUTFILE = resolve(NATIVE_OUTDIR, 'claude');
const NODE_OUTDIR = resolve(ROOT, 'apps/desktop/src-tauri/resources/node/bin');
const NODE_OUTFILE = resolve(NODE_OUTDIR, 'node');

async function findClaudeNativeBinary() {
  const packageName = `@anthropic-ai+claude-agent-sdk-${process.platform}-${process.arch}`;
  const pnpmDir = resolve(ROOT, 'node_modules/.pnpm');
  const entries = await readdir(pnpmDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${packageName}@`)) continue;
    return resolve(
      pnpmDir,
      entry.name,
      'node_modules',
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
      'claude',
    );
  }
  throw new Error(
    `Claude Agent SDK native binary package ${packageName} was not found under node_modules/.pnpm.`,
  );
}

async function copyClaudeNativeBinary() {
  const source = await findClaudeNativeBinary();
  await rm(NATIVE_OUTDIR, { recursive: true, force: true });
  await mkdir(NATIVE_OUTDIR, { recursive: true });
  await copyFile(source, NATIVE_OUTFILE);
  await chmod(NATIVE_OUTFILE, 0o755);
  return NATIVE_OUTFILE;
}

async function copyNodeRuntime() {
  const source = process.execPath;
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
const nativeBinary = await copyClaudeNativeBinary();
const nodeRuntime = await copyNodeRuntime();

console.log(JSON.stringify({ ok: true, outfile: OUTFILE, nativeBinary, nodeRuntime }, null, 2));
