#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { harnessById, validateHarnessIds } from './harness-manifest.mjs';
import { repoRoot } from './lib/harness-runner.mjs';

function selectedIds(argv) {
  const onlyIndex = argv.indexOf('--only');
  if (onlyIndex === -1) return [...validateHarnessIds];
  const id = argv[onlyIndex + 1];
  if (!id || argv.length !== 2) {
    throw new Error('usage: node scripts/run-harnesses.mjs [--only <id>]');
  }
  return [id];
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      env: process.env,
      shell: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

let ids;
try {
  ids = selectedIds(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

if (ids) {
  const failures = [];
  for (const id of ids) {
    const entry = harnessById.get(id);
    if (!entry) {
      console.error(`[harness-runner] unknown harness id: ${id}`);
      failures.push(id);
      continue;
    }

    const result = await runCommand(entry.command);
    if (result.code !== 0 || result.signal) {
      failures.push(id);
      console.error(
        `[harness-runner] ${id} failed${result.signal ? ` (signal ${result.signal})` : ` (exit ${result.code})`}`,
      );
      break;
    }
  }

  if (failures.length > 0) {
    console.error(
      `[harness-runner] ${failures.length}/${ids.length} failed: ${failures.join(', ')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`[harness-runner] ${ids.length}/${ids.length} passed`);
  }
}
