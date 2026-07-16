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
const REQUIRED_COMMANDS_BY_MODULE = {
  pi_agent_host: {
    handlerPath: 'pi_agent_host',
    commands: [
      'agent_runtime_execute',
      'agent_runtime_enhance',
      'agent_runtime_collaborate',
      'agent_runtime_resume',
      'agent_runtime_abort',
      'agent_runtime_control',
      'agent_runtime_confirm_execution',
      'agent_runtime_answer',
      'agent_runtime_stream_snapshot',
      'agent_runtime_release_stream',
      'agent_runtime_reattach',
      'agent_runtime_status',
    ],
  },
  codex_agent_host: {
    handlerPath: 'codex_agent_host::commands',
    commands: [
      'codex_agent_execute',
      'codex_agent_enhance',
      'codex_agent_resume',
      'codex_agent_abort',
      'codex_agent_answer',
      'codex_agent_stream_snapshot',
      'codex_agent_release_stream',
      'codex_agent_reattach',
      'codex_agent_status',
    ],
  },
  claude_agent_host: {
    handlerPath: 'claude_agent_host::commands',
    commands: [
      'claude_agent_execute',
      'claude_agent_enhance',
      'claude_agent_resume',
      'claude_agent_abort',
      'claude_agent_answer',
      'claude_agent_stream_snapshot',
      'claude_agent_release_stream',
      'claude_agent_reattach',
      'claude_agent_status',
    ],
  },
};
const REQUIRED_COMMANDS = Object.values(REQUIRED_COMMANDS_BY_MODULE).flatMap(
  ({ commands }) => commands,
);

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
// Match each command's concrete engine module so a stray comment or a second
// transport lane cannot satisfy the production registration gate.
const missingFromHandler = Object.entries(REQUIRED_COMMANDS_BY_MODULE).flatMap(
  ([moduleName, { handlerPath, commands }]) =>
    commands
      .filter((command) => !libRs.includes(`${handlerPath}::${command}`))
      .map((command) => `${moduleName}::${command}`),
);
if (missingFromHandler.length > 0) {
  fail(
    `lib.rs generate_handler! is missing commands: ${missingFromHandler.join(', ')} (register each command under its declared engine handler path)`,
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
