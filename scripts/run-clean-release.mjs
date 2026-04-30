#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const webPort = 5176;
const appPath = path.join(root, 'apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app');
const webLogPath = path.join(root, 'output/run-action-web-dev.log');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function pidsForPort(port) {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((pid) => Number.parseInt(pid.trim(), 10))
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

function killPid(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
  } catch {
    // The process may already be gone.
  }
}

function killPort(port) {
  for (const pid of pidsForPort(port)) killPid(pid);
}

function killOffisimDesktop() {
  spawnSync('osascript', ['-e', 'tell application "Offisim" to quit'], {
    cwd: root,
    stdio: 'ignore',
  });
  try {
    const output = execFileSync('pgrep', ['-f', 'offisim-desktop'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const pid of output.split('\n')) {
      const parsed = Number.parseInt(pid.trim(), 10);
      if (Number.isInteger(parsed)) killPid(parsed);
    }
  } catch {
    // No existing desktop process.
  }
}

function removePath(relativePath) {
  rmSync(path.join(root, relativePath), { recursive: true, force: true });
}

function cleanBuildArtifacts() {
  run('pnpm', ['--filter', './apps/**', '--filter', './packages/**', '--if-present', 'clean']);
  for (const artifact of [
    '.turbo',
    'apps/desktop/.turbo',
    'apps/desktop/src-tauri/target',
    'apps/launcher/.turbo',
    'apps/launcher/dist',
    'apps/launcher/src-tauri/target',
    'apps/web/dist',
    'apps/platform/dist',
  ]) {
    removePath(artifact);
  }
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isPortOpen('127.0.0.1', port)) || (await isPortOpen('::1', port))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`web dev server did not open port ${port} within ${timeoutMs}ms`);
}

async function startWebDev() {
  mkdirSync(path.dirname(webLogPath), { recursive: true });
  const logFd = openSync(webLogPath, 'a');
  const child = spawn('pnpm', ['--filter', '@offisim/web', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });
  child.unref();
  await waitForPort(webPort, 45_000);
}

async function main() {
  console.log('[run-clean-release] stopping existing desktop app and web dev port');
  killOffisimDesktop();
  killPort(webPort);

  console.log('[run-clean-release] cleaning build artifacts');
  cleanBuildArtifacts();

  console.log('[run-clean-release] building release desktop package');
  run('pnpm', ['--filter', '@offisim/desktop', 'build']);

  console.log('[run-clean-release] starting web dev server on http://localhost:5176');
  await startWebDev();
  spawnSync('open', [`http://localhost:${webPort}`], { cwd: root, stdio: 'ignore' });

  console.log('[run-clean-release] opening release Offisim.app');
  run('open', ['-n', appPath], { stdio: 'inherit' });

  console.log(`[run-clean-release] done. Web dev log: ${webLogPath}`);
}

main().catch((error) => {
  console.error(`[run-clean-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
