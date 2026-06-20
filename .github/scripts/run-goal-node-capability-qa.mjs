#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const checks = [
  ['doc-engine', 'pnpm', ['harness:doc-engine']],
  ['attachment-roundtrip', 'pnpm', ['harness:chat-attachment-roundtrip']],
  ['platform-migration-drift', 'pnpm', ['platform:migration:drift']],
  ['platform-auth', 'pnpm', ['platform:auth-harness']],
  ['pi-host-build', 'pnpm', ['build:pi-agent-host']],
  ['renderer-typecheck', 'pnpm', ['--filter', '@offisim/desktop-renderer', 'typecheck']],
  ['renderer-build', 'pnpm', ['--filter', '@offisim/desktop-renderer', 'build']],
];

const results = [];

for (const [id, command, args] of checks) {
  const startedAt = Date.now();
  console.log(`\n===== goal-check:${id} =====`);
  console.log(`${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  });
  const status = result.status === 0 ? 'pass' : 'fail';
  const record = {
    id,
    status,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    error: result.error?.message ?? null,
  };
  results.push(record);
  console.log(`===== goal-check:${id}:${status} =====`);
}

const scenarioRequirements = {
  S01: ['renderer-typecheck', 'renderer-build'],
  S02: ['renderer-typecheck', 'renderer-build'],
  S03: ['pi-host-build'],
  S04: ['attachment-roundtrip'],
  S05: ['renderer-typecheck', 'renderer-build'],
  S06: ['renderer-typecheck', 'renderer-build'],
  S07: ['pi-host-build', 'renderer-build'],
  S08: ['platform-auth', 'platform-migration-drift'],
  S09: ['renderer-build'],
  S10: ['renderer-build'],
  S11: ['platform-auth', 'platform-migration-drift'],
  S12: ['doc-engine'],
};

const byId = new Map(results.map((result) => [result.id, result]));
const scenarios = Object.entries(scenarioRequirements).map(([id, requiredChecks]) => ({
  id,
  requiredChecks,
  status: requiredChecks.every((checkId) => byId.get(checkId)?.status === 'pass')
    ? 'pass'
    : 'fail',
}));
const failedChecks = results.filter((result) => result.status !== 'pass');
const failedScenarios = scenarios.filter((scenario) => scenario.status !== 'pass');

console.log('\n===== goal-node-capability-summary =====');
console.log(
  JSON.stringify(
    {
      evaluation: 'pass/fail; each targeted command must exit 0',
      conditions: {
        os: process.platform,
        node: process.version,
        ci: process.env.CI ?? null,
      },
      checks: results,
      scenarios,
      overallStatus: failedChecks.length === 0 && failedScenarios.length === 0 ? 'pass' : 'fail',
    },
    null,
    2,
  ),
);
console.log('===== end-goal-node-capability-summary =====');

process.exitCode = failedChecks.length === 0 && failedScenarios.length === 0 ? 0 : 1;
