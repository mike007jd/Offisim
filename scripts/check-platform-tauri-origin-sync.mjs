#!/usr/bin/env node
// Origin-sync smoke check for the desktop release `.app` ↔ platform server CORS / CSP coupling.
//   Invariant A — CSP `connect-src` SHALL include every platform listen origin the desktop webview reaches.
//   Invariant B — `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` SHALL include `tauri://localhost`.
// Wired into `apps/desktop` and `apps/platform` `prebuild` so a drift on either side fails the build.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const TAURI_CONF_PATH = resolve(REPO_ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const PLATFORM_STARTUP_PATH = resolve(REPO_ROOT, 'apps/platform/src/startup.ts');

// Default platform listen port. SSOT is `apps/platform/src/index.ts` which reads
// `process.env.PORT ?? '4100'`. We use the same env var here so a developer who
// sets `PORT=4200` to run platform also has the smoke check validate against 4200.
const DEFAULT_PLATFORM_PORT = 4100;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readTauriCsp() {
  let raw;
  try {
    raw = readFileSync(TAURI_CONF_PATH, 'utf8');
  } catch (err) {
    fail(`FAIL — could not read ${TAURI_CONF_PATH}: ${err.message}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`FAIL — ${TAURI_CONF_PATH} is not valid JSON: ${err.message}`);
  }
  const csp = json?.app?.security?.csp;
  if (typeof csp !== 'string' || csp.length === 0) {
    fail(
      `FAIL — expected app.security.csp to be a non-empty string in ${TAURI_CONF_PATH}; origin-sync check cannot run. Update the smoke check OR keep the field stable.`,
    );
  }
  return csp;
}

function tokenizeConnectSrc(csp) {
  // CSP directives are separated by `;` and tokens by whitespace.
  // Find `connect-src` directive and return its origin tokens.
  const directives = csp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const connectSrc = directives.find((d) => /^connect-src(\s|$)/i.test(d));
  if (!connectSrc) {
    fail(
      `FAIL — CSP in ${TAURI_CONF_PATH} has no \`connect-src\` directive; cannot enforce Invariant A. Edit apps/desktop/src-tauri/tauri.conf.json.`,
    );
  }
  const tokens = connectSrc.split(/\s+/).slice(1);
  return tokens;
}

function readPlatformOrigins() {
  let raw;
  try {
    raw = readFileSync(PLATFORM_STARTUP_PATH, 'utf8');
  } catch (err) {
    fail(`FAIL — could not read ${PLATFORM_STARTUP_PATH}: ${err.message}`);
  }
  // Match `export const DEV_DEFAULT_ORIGINS = [ ... ];` array literal. The constant
  // is intentionally a stable shape; if the file is refactored to load from JSON or
  // env, this regex fails loud and the developer must update either the smoke check
  // or keep the literal stable (see design.md Risks).
  const match = raw.match(/export\s+const\s+DEV_DEFAULT_ORIGINS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!match) {
    fail(
      `FAIL — could not locate \`export const DEV_DEFAULT_ORIGINS = [...]\` literal in ${PLATFORM_STARTUP_PATH}. Update scripts/check-platform-tauri-origin-sync.mjs OR restore the literal shape per design.md Decision 4.`,
    );
  }
  const body = match[1];
  const origins = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (origins.length === 0) {
    fail(
      `FAIL — \`DEV_DEFAULT_ORIGINS\` in ${PLATFORM_STARTUP_PATH} parsed as empty; expected at least one string origin. Verify the literal contents.`,
    );
  }
  return origins;
}

function resolvePlatformPort() {
  const envOverride = process.env.PORT;
  if (envOverride) {
    const parsed = Number.parseInt(envOverride, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      fail(`FAIL — PORT=${envOverride} is not a valid port number.`);
    }
    return parsed;
  }
  return DEFAULT_PLATFORM_PORT;
}

function checkInvariantA(connectSrcTokens, port, failures) {
  const required = [`http://localhost:${port}`, `https://localhost:${port}`, 'tauri://localhost'];
  for (const origin of required) {
    if (!connectSrcTokens.includes(origin)) {
      failures.push(
        `FAIL — Invariant A: CSP connect-src missing ${origin}; edit apps/desktop/src-tauri/tauri.conf.json`,
      );
    }
  }
  return required;
}

function checkInvariantB(platformOrigins, failures) {
  const required = ['tauri://localhost'];
  for (const origin of required) {
    if (!platformOrigins.includes(origin)) {
      failures.push(
        `FAIL — Invariant B: platform CORS missing ${origin}; edit apps/platform/src/startup.ts`,
      );
    }
  }
  return required;
}

function main() {
  const port = resolvePlatformPort();
  const csp = readTauriCsp();
  const connectSrcTokens = tokenizeConnectSrc(csp);
  const platformOrigins = readPlatformOrigins();

  const failures = [];
  const checkedA = checkInvariantA(connectSrcTokens, port, failures);
  const checkedB = checkInvariantB(platformOrigins, failures);

  if (failures.length > 0) {
    for (const line of failures) console.error(line);
    process.exit(1);
  }

  console.log(
    `OK — origin-sync: Invariant A (CSP connect-src) covers [${checkedA.join(', ')}]; ` +
      `Invariant B (platform CORS) covers [${checkedB.join(', ')}].`,
  );
}

main();
