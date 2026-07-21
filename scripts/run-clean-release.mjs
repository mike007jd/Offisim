#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDesktopCargoTestPrereqs } from './prepare-desktop-cargo-test.mjs';
import { readReleaseContract } from './release-contract.mjs';
import { RELEASE_GATES, gateCwd } from './release-gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appPath = path.join(
  root,
  'apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app',
);

// Release gates are mandatory; see Docs/00_start_here/RELEASE_GATES.md.
// `--skip-gates` exists for fast local iteration only — the evidence summary
// records the skip and the run does not count as release evidence.
const skipGates = process.argv.includes('--skip-gates');

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
  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n===== gate: ${gate.name} (${gate.command} ${gate.args.join(' ')}) =====\n`);
  return new Promise((resolve) => {
    const finish = (footer, result) => {
      logStream.end(footer);
      resolve({ ...result, durationMs: Date.now() - startedAt });
    };
    const child = spawn(gate.command, gate.args, {
      cwd: gateCwd(gate),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const tee = (chunk, stream) => {
      stream.write(chunk);
      logStream.write(chunk);
    };
    child.stdout.on('data', (chunk) => tee(chunk, process.stdout));
    child.stderr.on('data', (chunk) => tee(chunk, process.stderr));
    child.on('close', (code) => {
      const status = code === 0 ? 'pass' : 'fail';
      finish(`===== gate: ${gate.name} → ${status} (exit ${code}) =====\n`, {
        name: gate.name,
        status,
        exitCode: code,
      });
    });
    child.on('error', (error) => {
      finish(`===== gate: ${gate.name} → spawn error: ${error.message} =====\n`, {
        name: gate.name,
        status: 'fail',
        exitCode: null,
        error: error.message,
      });
    });
  });
}

// Deterministic content hash of the .app bundle: sha256 over each file's
// (relative path, bytes) in sorted order, streamed so peak memory stays at
// chunk size rather than the largest binary in the bundle.
async function hashAppBundle(bundlePath) {
  const aggregate = createHash('sha256');
  const walk = async (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(bundlePath, absolute);
      aggregate.update(relative);
      aggregate.update('\0');
      if (entry.isDirectory()) {
        aggregate.update('directory\0');
        await walk(absolute);
      } else if (entry.isFile()) {
        aggregate.update('file\0');
        await new Promise((resolve, reject) => {
          createReadStream(absolute)
            .on('data', (chunk) => aggregate.update(chunk))
            .on('end', resolve)
            .on('error', reject);
        });
      } else if (entry.isSymbolicLink()) {
        aggregate.update('symlink\0');
        aggregate.update(readlinkSync(absolute));
      } else {
        throw new Error(`unsupported bundle entry type: ${relative}`);
      }
      aggregate.update('\0');
    }
  };
  await walk(bundlePath);
  return aggregate.digest('hex');
}

function cleanBuildArtifacts() {
  run('pnpm', [
    '--filter',
    './apps/**',
    '--filter',
    './packages/**',
    '--if-present',
    'run',
    'clean',
  ]);
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

async function main() {
  const releaseContract = readReleaseContract(root);
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
    releaseVersion: releaseContract.version,
    nodeVersion: releaseContract.nodeVersion,
    gatesSkipped: skipGates,
    gates: [],
    appPath,
    bundleSha256: null,
    releaseEvidence: false,
    evidenceDisqualifiers: [
      ...(skipGates ? ['gates_skipped'] : []),
      ...(git.dirty === true ? ['dirty_worktree'] : []),
      ...(git.dirty === null ? ['git_state_unknown'] : []),
    ],
  };
  const writeSummary = () => writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (skipGates) {
    console.warn(
      '[run-clean-release] ⚠️  --skip-gates: release gates NOT run. This build is for local ' +
        'iteration only and must not be used as release evidence.',
    );
    writeSummary();
  } else {
    if (git.dirty !== false) {
      writeSummary();
      console.error(
        '[run-clean-release] release evidence requires a clean, readable Git worktree. ' +
          'Use --skip-gates only for a non-evidence QA build.',
      );
      process.exit(1);
    }
    console.log(`[run-clean-release] running release gates (evidence: ${evidenceDir})`);
    for (const gate of RELEASE_GATES) {
      if (gate.name === 'cargo-test') ensureDesktopCargoTestPrereqs();
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

  console.log('[run-clean-release] cleaning build artifacts');
  cleanBuildArtifacts();

  console.log('[run-clean-release] building release desktop package');
  run('pnpm', ['--filter', '@offisim/desktop', 'build']);

  console.log('[run-clean-release] hashing release bundle');
  summary.bundleSha256 = await hashAppBundle(appPath);
  const finalGit = gitInfo();
  summary.finalGitCommit = finalGit.commit;
  summary.finalGitDirty = finalGit.dirty;
  if (finalGit.commit !== git.commit) {
    summary.evidenceDisqualifiers.push('commit_changed_during_release');
  }
  if (finalGit.dirty !== false) {
    summary.evidenceDisqualifiers.push(
      finalGit.dirty === true ? 'worktree_changed_during_release' : 'final_git_state_unknown',
    );
  }
  summary.releaseEvidence = summary.evidenceDisqualifiers.length === 0;
  writeSummary();
  if (!skipGates && !summary.releaseEvidence) {
    console.error('[run-clean-release] source changed during gates/build; evidence is invalid.');
    process.exit(1);
  }
  console.log(`[run-clean-release] bundle sha256: ${summary.bundleSha256}`);
  console.log(`[run-clean-release] evidence written to ${evidenceDir}`);
  console.log(
    '[run-clean-release] done. Launch and verify the exact release app with Computer Use.',
  );
}

main().catch((error) => {
  console.error(`[run-clean-release] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
