#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { getTauriBeforeDevConfig } from './dev-config.mjs';
import { ensurePortFree } from './ensure-port-free.mjs';

const app = process.argv[2];

if (!app) {
  console.error('[tauri-before-dev] Usage: node scripts/tauri-before-dev.mjs <desktop|launcher>');
  process.exit(1);
}

const config = getTauriBeforeDevConfig(app);

if (process.env[config.skipEnvVar]) {
  process.exit(0);
}

ensurePortFree(config.port);

const child = spawn(config.command[0], config.command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

const forwardSignal = (signal) => {
  child.kill(signal);
};

process.on('SIGINT', forwardSignal);
process.on('SIGTERM', forwardSignal);

child.on('exit', (code, signal) => {
  process.removeListener('SIGINT', forwardSignal);
  process.removeListener('SIGTERM', forwardSignal);

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[tauri-before-dev] Failed to start child process:', error);
  process.exit(1);
});
