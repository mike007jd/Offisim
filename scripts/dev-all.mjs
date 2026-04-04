#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { createDevAllProcesses } from './dev-config.mjs';
import { ensurePortFree } from './ensure-port-free.mjs';

const processes = createDevAllProcesses();
const children = new Map();
let shuttingDown = false;

ensurePortFree(4100);
ensurePortFree(4200);
ensurePortFree(5176);

function prefixStream(name, stream, target) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`[${name}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      target.write(`[${name}] ${buffer}\n`);
      buffer = '';
    }
  });
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children.values()) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode == null && !child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(exitCode);
  }, 1000).unref();
}

for (const entry of processes) {
  const child = spawn(entry.command[0], entry.command.slice(1), {
    cwd: entry.cwd,
    env: {
      ...process.env,
      ...entry.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.set(entry.name, child);
  prefixStream(entry.name, child.stdout, process.stdout);
  prefixStream(entry.name, child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const summary = signal
      ? `${entry.name} exited from signal ${signal}`
      : `${entry.name} exited with code ${code ?? 0}`;
    process.stderr.write(`[dev:all] ${summary}\n`);
    stopAll(code ?? 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) return;
    process.stderr.write(`[dev:all] failed to start ${entry.name}: ${String(error)}\n`);
    stopAll(1);
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
