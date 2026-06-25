#!/usr/bin/env node
/**
 * Build-time guard: every agent-runtime gateway Tauri command MUST be BOTH
 * registered in the `generate_handler!` block of lib.rs AND allowlisted in the
 * `agent-bridges` permission's `commands.allow`. A privileged command missing
 * from either side silently no-ops at runtime (no handler → not callable; not in
 * the allowlist → IPC rejected by the capability), so this gate fails the build
 * instead of shipping a release where the renderer gateway invoke does nothing.
 *
 * Mirrors the `check-attachment-capabilities.mjs` pattern — wired into the
 * `validate` chain alongside the other check:* gates.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LIB_RS = resolve(ROOT, 'apps/desktop/src-tauri/src/lib.rs');
const PERMISSION_FILE = resolve(ROOT, 'apps/desktop/src-tauri/permissions/agent-bridges.toml');
const REQUIRED_COMMANDS = [
  'agent_runtime_execute',
  'agent_runtime_abort',
  'agent_runtime_answer',
  'agent_runtime_status',
];

function fail(msg) {
  console.error(`[check-agent-runtime-capabilities] ${msg}`);
  process.exit(1);
}

if (!existsSync(LIB_RS)) {
  fail(`missing lib.rs ${LIB_RS}`);
}
if (!existsSync(PERMISSION_FILE)) {
  fail(`missing permission file ${PERMISSION_FILE}`);
}

const libRs = readFileSync(LIB_RS, 'utf8');
// The command must be registered as `pi_agent_host::<command>` inside the
// generate_handler! block. Match the fully-qualified path so a stray comment
// mention elsewhere can't satisfy the gate.
const missingFromHandler = REQUIRED_COMMANDS.filter(
  (cmd) => !libRs.includes(`pi_agent_host::${cmd}`),
);
if (missingFromHandler.length > 0) {
  fail(
    `lib.rs generate_handler! is missing commands: ${missingFromHandler.join(', ')} ` +
      `(add pi_agent_host::<command> to the invoke_handler list)`,
  );
}

const permission = readFileSync(PERMISSION_FILE, 'utf8');
const missingFromAllowlist = REQUIRED_COMMANDS.filter((cmd) => !permission.includes(`"${cmd}"`));
if (missingFromAllowlist.length > 0) {
  fail(
    `permission ${PERMISSION_FILE} commands.allow is missing: ${missingFromAllowlist.join(', ')}`,
  );
}

console.log(
  `[check-agent-runtime-capabilities] ok — ${REQUIRED_COMMANDS.length} agent-runtime commands registered in lib.rs and allowlisted in agent-bridges.toml`,
);
