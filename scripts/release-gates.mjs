#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The cargo-test gate compiles apps/desktop/src-tauri, whose tauri-build step
// validates that every bundle.resources path exists. The copied Node runtime
// and generated Pi Agent host bundle are both git-ignored, so a fresh checkout
// needs cargo-test-only placeholders. cargo test never spawns the sidecar. These
// placeholders never leak into a shipped bundle: a real `tauri build` always
// runs build:pi-agent-host first and overwrites both before tauri-build validates
// them.
function ensureCargoTestPrereqs() {
  const nodeResource = path.join(root, 'apps/desktop/src-tauri/resources/node/bin/node');
  const hostResource = path.join(root, 'apps/desktop/src-tauri/resources/pi-agent-host.mjs');

  if (!existsSync(nodeResource)) {
    mkdirSync(path.dirname(nodeResource), { recursive: true });
    writeFileSync(nodeResource, '#!/bin/sh\n');
    chmodSync(nodeResource, 0o755);
    console.log(`[release-gates] stubbed missing test resource ${nodeResource}`);
  }

  if (!existsSync(hostResource)) {
    mkdirSync(path.dirname(hostResource), { recursive: true });
    writeFileSync(
      hostResource,
      'THIS IS A CARGO-TEST-ONLY STUB — run scripts/build-pi-agent-host.mjs\n',
    );
    console.log(`[release-gates] stubbed missing test resource ${hostResource}`);
  }
}

// Single source of truth for the core release gates. Consumed with evidence
// logging by run-clean-release.mjs and executed directly by
// .github/workflows/ci.yml (`--lane=node` on ubuntu, `--lane=rust` on macos).
// The prose table in Docs/00_start_here/RELEASE_GATES.md describes this list.
export const RELEASE_GATES = [
  // `validate` already runs typecheck plus the Pi-only runtime guards, Studio
  // placement check, and official Pi Agent Host harness.
  { name: 'validate', lane: 'node', command: 'pnpm', args: ['validate'] },
  { name: 'ui-hygiene', lane: 'node', command: 'pnpm', args: ['check:ui-hygiene'] },
  { name: 'security-harness', lane: 'node', command: 'pnpm', args: ['security:harness'] },
  {
    name: 'supply-chain-audit',
    lane: 'node',
    command: 'pnpm',
    args: ['audit', '--prod', '--audit-level', 'high'],
  },
  {
    name: 'cargo-test',
    lane: 'rust',
    command: 'cargo',
    args: ['test', '--locked'],
    cwd: 'apps/desktop/src-tauri',
  },
];

export function gateCwd(gate) {
  return gate.cwd ? path.join(root, gate.cwd) : root;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const laneArg =
    process.argv.find((arg) => arg.startsWith('--lane='))?.slice('--lane='.length) ?? 'all';
  const gates = RELEASE_GATES.filter((gate) => laneArg === 'all' || gate.lane === laneArg);
  if (gates.length === 0) {
    console.error(`[release-gates] unknown lane "${laneArg}" (node|rust|all)`);
    process.exit(1);
  }
  for (const gate of gates) {
    if (gate.name === 'cargo-test') ensureCargoTestPrereqs();
    console.log(`[release-gates] ${gate.name}: ${gate.command} ${gate.args.join(' ')}`);
    const result = spawnSync(gate.command, gate.args, {
      cwd: gateCwd(gate),
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      console.error(`[release-gates] gate "${gate.name}" failed (exit ${result.status})`);
      process.exit(result.status ?? 1);
    }
  }
  console.log(`[release-gates] ${gates.length} gate(s) green (lane: ${laneArg})`);
}
