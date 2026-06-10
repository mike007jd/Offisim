#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const rendererPort = 5176;
const platformPort = 4100;
const appPath = path.join(root, 'apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app');
const rendererLogPath = path.join(root, 'output/run-action-renderer-dev.log');
const platformLogPath = path.join(root, 'output/run-action-platform-dev.log');

// Release gates are mandatory (PRELAUNCH_AUDIT_2026-06-10 B1). `--skip-gates`
// exists for fast local iteration only — the evidence summary records the skip
// and the run does not count as release evidence.
const skipGates = process.argv.includes('--skip-gates');

// Same core set as .github/workflows/ci.yml and RELEASE_GATES.md.
const RELEASE_GATES = [
  { name: 'validate', command: 'pnpm', args: ['validate'] },
  { name: 'ui-hygiene', command: 'pnpm', args: ['check:ui-hygiene'] },
  { name: 'deterministic-harness', command: 'pnpm', args: ['harness:deterministic'] },
  { name: 'security-harness', command: 'pnpm', args: ['security:harness'] },
  {
    name: 'cargo-test',
    command: 'cargo',
    args: ['test'],
    cwd: path.join(root, 'apps/desktop/src-tauri'),
  },
];

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

function killOffisimPlatform() {
  try {
    const output = execFileSync(
      'pgrep',
      ['-f', '@offisim/platform dev|apps/platform/.+tsx.+watch src/index.ts'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    for (const pid of output.split('\n')) {
      const parsed = Number.parseInt(pid.trim(), 10);
      if (Number.isInteger(parsed)) killPid(parsed);
    }
  } catch {
    // No existing platform dev process.
  }
}

function removePath(relativePath) {
  rmSync(path.join(root, relativePath), { recursive: true, force: true });
}

function gitInfo() {
  const exec = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    return {
      commit: exec(['rev-parse', 'HEAD']).trim(),
      dirty: exec(['status', '--porcelain']).trim().length > 0,
    };
  } catch {
    return { commit: 'unknown', dirty: null };
  }
}

function runGate(gate, logPath) {
  const startedAt = Date.now();
  const header = `\n===== gate: ${gate.name} (${gate.command} ${gate.args.join(' ')}) =====\n`;
  appendFileSync(logPath, header);
  return new Promise((resolve) => {
    const child = spawn(gate.command, gate.args, {
      cwd: gate.cwd ?? root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const tee = (chunk, stream) => {
      stream.write(chunk);
      appendFileSync(logPath, chunk);
    };
    child.stdout.on('data', (chunk) => tee(chunk, process.stdout));
    child.stderr.on('data', (chunk) => tee(chunk, process.stderr));
    child.on('close', (code) => {
      const status = code === 0 ? 'pass' : 'fail';
      appendFileSync(logPath, `===== gate: ${gate.name} → ${status} (exit ${code}) =====\n`);
      resolve({ name: gate.name, status, exitCode: code, durationMs: Date.now() - startedAt });
    });
    child.on('error', (error) => {
      appendFileSync(logPath, `===== gate: ${gate.name} → spawn error: ${error.message} =====\n`);
      resolve({
        name: gate.name,
        status: 'fail',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
    });
  });
}

// Deterministic content hash of the .app bundle: sha256 over each file's
// (relative path, bytes) in sorted order. Symlinks/dirs contribute their path
// + link target only.
function hashAppBundle(bundlePath) {
  const aggregate = createHash('sha256');
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(bundlePath, absolute);
      aggregate.update(relative);
      aggregate.update('\0');
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        aggregate.update(readFileSync(absolute));
      }
      aggregate.update('\0');
    }
  };
  walk(bundlePath);
  return aggregate.digest('hex');
}

function cleanBuildArtifacts() {
  run('pnpm', ['--filter', './apps/**', '--filter', './packages/**', '--if-present', 'clean']);
  for (const artifact of [
    '.turbo',
    'apps/desktop/.turbo',
    'apps/desktop/src-tauri/target',
    'apps/desktop/renderer/dist',
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
  throw new Error(`renderer dev server did not open port ${port} within ${timeoutMs}ms`);
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the server is ready or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not return HTTP 2xx within ${timeoutMs}ms`);
}

async function startPlatformDev() {
  mkdirSync(path.dirname(platformLogPath), { recursive: true });
  const logFd = openSync(platformLogPath, 'a');
  const child = spawn('pnpm', ['--filter', '@offisim/platform', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  await waitForHttpOk(`http://localhost:${platformPort}/health`, 45_000);
}

async function startRendererDev() {
  mkdirSync(path.dirname(rendererLogPath), { recursive: true });
  const logFd = openSync(rendererLogPath, 'a');
  const child = spawn('pnpm', ['--filter', '@offisim/desktop-renderer', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });
  child.unref();
  await waitForPort(rendererPort, 45_000);
}

async function main() {
  const git = gitInfo();
  const evidenceDir = path.join(
    root,
    'output/release-evidence',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${git.commit.slice(0, 8)}`,
  );
  mkdirSync(evidenceDir, { recursive: true });
  const gatesLogPath = path.join(evidenceDir, 'gates.log');
  const summaryPath = path.join(evidenceDir, 'summary.json');
  const summary = {
    createdAt: new Date().toISOString(),
    gitCommit: git.commit,
    gitDirty: git.dirty,
    gatesSkipped: skipGates,
    gates: [],
    appPath,
    bundleSha256: null,
    releaseEvidence: false,
  };
  const writeSummary = () => writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (skipGates) {
    console.warn(
      '[run-clean-release] ⚠️  --skip-gates: release gates NOT run. This build is for local ' +
        'iteration only and must not be used as release evidence.',
    );
    writeSummary();
  } else {
    console.log(`[run-clean-release] running release gates (evidence: ${evidenceDir})`);
    for (const gate of RELEASE_GATES) {
      console.log(`[run-clean-release] gate: ${gate.name}`);
      const result = await runGate(gate, gatesLogPath);
      summary.gates.push(result);
      writeSummary();
      if (result.status !== 'pass') {
        console.error(
          `[run-clean-release] gate "${result.name}" failed (exit ${result.exitCode}). ` +
            `Aborting release. Log: ${gatesLogPath}`,
        );
        process.exit(1);
      }
    }
    console.log('[run-clean-release] all release gates green');
  }

  console.log(
    '[run-clean-release] stopping existing desktop app, platform, and renderer dev ports',
  );
  killOffisimDesktop();
  killOffisimPlatform();
  killPort(platformPort);
  killPort(rendererPort);

  console.log('[run-clean-release] cleaning build artifacts');
  cleanBuildArtifacts();

  console.log('[run-clean-release] building release desktop package');
  run('pnpm', ['--filter', '@offisim/desktop', 'build']);

  console.log('[run-clean-release] hashing release bundle');
  summary.bundleSha256 = hashAppBundle(appPath);
  summary.releaseEvidence = !skipGates;
  writeSummary();
  console.log(`[run-clean-release] bundle sha256: ${summary.bundleSha256}`);
  console.log(`[run-clean-release] evidence written to ${evidenceDir}`);

  console.log('[run-clean-release] starting platform API on http://localhost:4100');
  await startPlatformDev();

  console.log('[run-clean-release] starting renderer dev server on http://localhost:5176');
  await startRendererDev();

  console.log('[run-clean-release] opening release Offisim.app');
  run('open', ['-n', appPath], { stdio: 'inherit' });

  console.log(
    `[run-clean-release] done. Platform log: ${platformLogPath}. Renderer dev log: ${rendererLogPath}`,
  );
}

main().catch((error) => {
  console.error(`[run-clean-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
