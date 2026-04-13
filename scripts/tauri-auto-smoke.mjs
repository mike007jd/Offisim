#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const REPO_ROOT = process.cwd();
const APP_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.offisim.desktop',
);
const REPORT_PATH = path.join(APP_DATA_DIR, 'dev-auto-smoke-report.json');
const DB_PATH = path.join(APP_DATA_DIR, 'offisim.db');
const TIMEOUT_MS = 120_000;
const RUNS = 2;

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {}
}

async function waitForReport() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (await fileExists(REPORT_PATH)) {
      const raw = await fs.readFile(REPORT_PATH, 'utf8');
      return JSON.parse(raw);
    }
    await delay(1000);
  }
  throw new Error(`Timed out after ${TIMEOUT_MS / 1000}s waiting for ${REPORT_PATH}`);
}

async function queryDuplicateRates() {
  if (!(await fileExists(DB_PATH))) return [];
  const { stdout } = await import('node:child_process').then(({ execFileSync }) => ({
    stdout: execFileSync(
      'sqlite3',
      [
        DB_PATH,
        "select provider || '|' || model_pattern || '|' || effective_from || '|' || count(*) from model_cost_rates group by provider, model_pattern, effective_from having count(*) > 1;",
      ],
      { encoding: 'utf8' },
    ),
  }));
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runOnce(index) {
  await fs.mkdir(APP_DATA_DIR, { recursive: true });
  await fs.rm(REPORT_PATH, { force: true });

  const logs = [];
  const child = spawn('pnpm', ['--filter', '@offisim/desktop', 'dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VITE_OFFISIM_AUTO_SMOKE: '1',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    logs.push(chunk.toString());
    if (logs.length > 200) logs.shift();
  });
  child.stderr.on('data', (chunk) => {
    logs.push(chunk.toString());
    if (logs.length > 200) logs.shift();
  });

  try {
    const report = await waitForReport();
    const duplicateRates = await queryDuplicateRates();
    return { index, report, duplicateRates, logs: logs.join('') };
  } finally {
    killProcessGroup(child);
    await delay(1500);
  }
}

async function main() {
  const results = [];
  for (let index = 1; index <= RUNS; index += 1) {
    const result = await runOnce(index);
    results.push(result);
    const smokeResult = result.report?.result;
    const ok = smokeResult?.ok === true && result.duplicateRates.length === 0;
    console.log(`run ${index}: ${ok ? 'PASS' : 'FAIL'}`);
    console.log(JSON.stringify(result.report, null, 2));
    if (result.duplicateRates.length > 0) {
      console.log('duplicate model_cost_rates rows:');
      for (const line of result.duplicateRates) console.log(line);
    }
    if (!ok) {
      console.log('recent logs:');
      console.log(result.logs.slice(-4000));
      process.exitCode = 1;
      return;
    }
  }
  console.log(`tauri auto smoke passed ${RUNS} cold runs`);
}

await main();
