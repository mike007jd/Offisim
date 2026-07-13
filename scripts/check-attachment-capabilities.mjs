#!/usr/bin/env node
/**
 * Build-time guard: every chat-attachment Tauri command MUST appear in the
 * `fs-shell` permission allowlist; capability JSONs MUST mount that
 * permission via `offisim:fs-shell` on the main + main-live renderer WebViews.
 *
 * Mirrors the `check-platform-tauri-origin-sync.mjs` pattern — invoked from
 * `apps/desktop` `prebuild` so a missing entry fails the build instead of
 * silently producing a release that no-ops the file picker.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PERMISSION_FILE = resolve(ROOT, 'apps/desktop/src-tauri/permissions/fs-shell.toml');
const CAPABILITY_FILE = resolve(ROOT, 'apps/desktop/src-tauri/capabilities/fs-shell.json');
const REQUIRED_COMMANDS = [
  'attachment_write',
  'attachment_read',
  'attachment_list',
  'attachment_list_all',
  'attachment_delete',
  'attachment_delete_company',
];
const REQUIRED_WEBVIEWS = ['main', 'main-live'];

function fail(msg) {
  console.error(`[check-attachment-capabilities] ${msg}`);
  process.exit(1);
}

if (!existsSync(PERMISSION_FILE)) {
  fail(`missing permission file ${PERMISSION_FILE}`);
}
if (!existsSync(CAPABILITY_FILE)) {
  fail(`missing capability file ${CAPABILITY_FILE}`);
}

const permission = readFileSync(PERMISSION_FILE, 'utf8');
const missing = REQUIRED_COMMANDS.filter((cmd) => !permission.includes(`"${cmd}"`));
if (missing.length > 0) {
  fail(`permission ${PERMISSION_FILE} is missing commands: ${missing.join(', ')}`);
}

const capability = JSON.parse(readFileSync(CAPABILITY_FILE, 'utf8'));
if (capability.identifier !== 'offisim:fs-shell') {
  fail(`capability ${CAPABILITY_FILE} identifier mismatch (got ${capability.identifier})`);
}
if (!Array.isArray(capability.permissions) || !capability.permissions.includes('fs-shell')) {
  fail(`capability ${CAPABILITY_FILE} must include permission "fs-shell"`);
}
if (!Array.isArray(capability.webviews)) {
  fail(`capability ${CAPABILITY_FILE} webviews must be an array`);
}
const missingWebviews = REQUIRED_WEBVIEWS.filter((label) => !capability.webviews.includes(label));
if (missingWebviews.length > 0) {
  fail(`capability ${CAPABILITY_FILE} webviews missing: ${missingWebviews.join(', ')}`);
}

console.log(
  `[check-attachment-capabilities] ok — ${REQUIRED_COMMANDS.length} attachment commands gated via ${capability.identifier}`,
);
