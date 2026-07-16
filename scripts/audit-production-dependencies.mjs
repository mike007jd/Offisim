#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

// pnpm 10 still calls npm's retired Quick Audit endpoints. pnpm 11 uses the
// supported Bulk Advisory endpoint, so keep the build toolchain stable while
// pinning the audit client independently. Checked against the npm and pnpm
// release documentation on 2026-07-16.
const AUDIT_PNPM_VERSION = '11.13.1';
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = [
  'dlx',
  `pnpm@${AUDIT_PNPM_VERSION}`,
  '--pm-on-fail=ignore',
  'audit',
  '--prod',
  '--audit-level',
  'high',
];

console.log(
  `[supply-chain-audit] pnpm ${AUDIT_PNPM_VERSION} via npm Bulk Advisory (high/critical fail)`,
);

const result = spawnSync(pnpmCommand, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Prevent the pinned audit client from switching itself back to the
    // repository's pnpm 10 build-tool version.
    COREPACK_ROOT: process.env.COREPACK_ROOT ?? 'offisim-audit',
  },
});

if (result.error) {
  console.error(`[supply-chain-audit] failed to start: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  console.error(`[supply-chain-audit] terminated by ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
