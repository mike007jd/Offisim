import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentHost } from './build-agent-host-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-codex-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/codex-agent-host.mjs');

await buildAgentHost({ root: ROOT, entry: ENTRY, outfile: OUTFILE });

console.log(JSON.stringify({ ok: true, outfile: OUTFILE }, null, 2));
