#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

export function listPids(targetPort) {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${targetPort}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function ensurePortFree(port) {
  const pids = listPids(port);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Ignore races where the process already exited.
    }
  }
}

function main() {
  const rawPort = process.argv[2];
  const port = Number.parseInt(rawPort ?? '', 10);

  if (!Number.isInteger(port) || port <= 0) {
    console.error('[ensure-port-free] Usage: node scripts/ensure-port-free.mjs <port>');
    process.exit(1);
  }

  ensurePortFree(port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
