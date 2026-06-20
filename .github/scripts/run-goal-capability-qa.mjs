#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(root, 'output', 'goal-capability-qa');
const logsDir = path.join(evidenceDir, 'logs');
const appPath = path.join(
  root,
  'apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app',
);

rmSync(evidenceDir, { recursive: true, force: true });
mkdirSync(logsDir, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const rel = (absolutePath) => path.relative(root, absolutePath);

function shortCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

async function hashDirectory(directory) {
  const aggregate = createHash('sha256');

  async function walk(currentDirectory) {
    const entries = readdirSync(currentDirectory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      const absolute = path.join(currentDirectory, entry.name);
      const relative = path.relative(directory, absolute);
      aggregate.update(relative);
      aggregate.update('\0');

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        await new Promise((resolve, reject) => {
          createReadStream(absolute)
            .on('data', (chunk) => aggregate.update(chunk))
            .on('end', resolve)
            .on('error', reject);
        });
      }

      aggregate.update('\0');
    }
  }

  await walk(directory);
  return aggregate.digest('hex');
}

const checks = [
  {
    id: 'environment',
    label: 'Pinned execution environment',
    command: 'bash',
    args: [
      '-lc',
      'set -e; sw_vers; printf "node="; node --version; printf "pnpm="; pnpm --version; printf "rustc="; rustc --version; printf "cargo="; cargo --version; printf "git="; git --version',
    ],
  },
  { id: 'typecheck', label: 'Workspace TypeScript typecheck', command: 'pnpm', args: ['typecheck'] },
  {
    id: 'pi-only-guards',
    label: 'Pi-only runtime guards',
    command: 'pnpm',
    args: ['harness:review-fixes'],
  },
  {
    id: 'studio-placement',
    label: 'Studio placement and collision harness',
    command: 'pnpm',
    args: ['harness:studio-placement'],
  },
  {
    id: 'pi-agent-host',
    label: 'Official Pi Agent Host harness',
    command: 'pnpm',
    args: ['harness:pi-agent-host'],
  },
  {
    id: 'conversation-run-controller',
    label: 'Conversation run controller harness',
    command: 'pnpm',
    args: ['harness:conversation-run-controller'],
  },
  {
    id: 'pi-wire-contract',
    label: 'Pi wire contract check',
    command: 'pnpm',
    args: ['check:pi-wire-contract'],
  },
  {
    id: 'pi-permission',
    label: 'Pi permission mode harness',
    command: 'pnpm',
    args: ['harness:pi-permission'],
  },
  { id: 'deadcode', label: 'Dead-code boundary check', command: 'pnpm', args: ['check:deadcode'] },
  {
    id: 'canonical-validate',
    label: 'Canonical validate aggregate',
    command: 'pnpm',
    args: ['validate'],
  },
  {
    id: 'ui-hygiene',
    label: 'Desktop renderer UI hygiene',
    command: 'pnpm',
    args: ['check:ui-hygiene'],
  },
  {
    id: 'security-harness',
    label: 'Aggregated security harness',
    command: 'pnpm',
    args: ['security:harness'],
  },
  {
    id: 'doc-engine',
    label: 'Document engine parser harness',
    command: 'pnpm',
    args: ['harness:doc-engine'],
  },
  {
    id: 'attachment-roundtrip',
    label: 'Chat attachment roundtrip harness',
    command: 'pnpm',
    args: ['harness:chat-attachment-roundtrip'],
  },
  {
    id: 'platform-migration-drift',
    label: 'Platform migration drift check',
    command: 'pnpm',
    args: ['platform:migration:drift'],
  },
  {
    id: 'platform-auth',
    label: 'Platform authentication boundary harness',
    command: 'pnpm',
    args: ['platform:auth-harness'],
  },
  {
    id: 'pi-host-build',
    label: 'Bundled Pi Agent Host build',
    command: 'pnpm',
    args: ['build:pi-agent-host'],
  },
  {
    id: 'renderer-typecheck',
    label: 'Desktop renderer typecheck',
    command: 'pnpm',
    args: ['--filter', '@offisim/desktop-renderer', 'typecheck'],
  },
  {
    id: 'renderer-build',
    label: 'Desktop renderer production build',
    command: 'pnpm',
    args: ['--filter', '@offisim/desktop-renderer', 'build'],
  },
  {
    id: 'cargo-test',
    label: 'Desktop Rust safety tests',
    command: 'cargo',
    args: ['test', '--locked'],
    cwd: 'apps/desktop/src-tauri',
  },
  {
    id: 'supply-chain-audit',
    label: 'Production dependency audit',
    command: 'pnpm',
    args: ['audit', '--prod', '--audit-level', 'high'],
  },
  {
    id: 'desktop-build',
    label: 'Exact desktop release bundle build',
    command: 'pnpm',
    args: ['--filter', '@offisim/desktop', 'build'],
  },
];

const scenarios = [
  {
    id: 'S01',
    name: 'Company lifecycle and safe local cleanup',
    checks: ['typecheck', 'cargo-test', 'renderer-build', 'release-app-live'],
  },
  {
    id: 'S02',
    name: 'Office workbench rendering and interaction shell',
    checks: ['typecheck', 'ui-hygiene', 'renderer-typecheck', 'renderer-build', 'release-app-live'],
  },
  {
    id: 'S03',
    name: 'Pi Agent runtime, wire protocol, and permission modes',
    checks: ['pi-only-guards', 'pi-agent-host', 'pi-wire-contract', 'pi-permission', 'pi-host-build'],
  },
  {
    id: 'S04',
    name: 'Workspace files, shell, git, and scoped attachments',
    checks: ['cargo-test', 'attachment-roundtrip', 'security-harness'],
  },
  {
    id: 'S05',
    name: 'Workspace apps and resumable conversation runs',
    checks: ['conversation-run-controller', 'typecheck', 'renderer-build', 'release-app-live'],
  },
  {
    id: 'S06',
    name: 'Personnel profiles, skills, memory, and runtime policy presentation',
    checks: ['typecheck', 'deadcode', 'renderer-build', 'release-app-live'],
  },
  {
    id: 'S07',
    name: 'Settings, Pi status, MCP boundaries, and provider-policy presentation',
    checks: ['pi-only-guards', 'pi-agent-host', 'ui-hygiene', 'renderer-build', 'release-app-live'],
  },
  {
    id: 'S08',
    name: 'Marketplace publish, preview, supported install, and ownership boundaries',
    checks: ['security-harness', 'platform-auth', 'platform-migration-drift', 'typecheck'],
  },
  {
    id: 'S09',
    name: 'Studio placement, collision, and deterministic layout state',
    checks: ['studio-placement', 'ui-hygiene', 'renderer-build'],
  },
  {
    id: 'S10',
    name: 'Activity, approvals, redaction, and recoverable failures',
    checks: ['security-harness', 'cargo-test', 'conversation-run-controller', 'release-app-live'],
  },
  {
    id: 'S11',
    name: 'Platform and registry authentication, schema, and security boundaries',
    checks: ['platform-auth', 'platform-migration-drift', 'security-harness', 'typecheck'],
  },
  {
    id: 'S12',
    name: 'Document parsing and hostile CSV/document handling',
    checks: ['doc-engine', 'security-harness', 'typecheck'],
  },
];

const globalChecks = ['canonical-validate', 'supply-chain-audit', 'desktop-build', 'release-app-live'];
const results = [];

async function runCommandCheck(check) {
  const logPath = path.join(logsDir, `${check.id}.log`);
  const stream = createWriteStream(logPath, { flags: 'w' });
  const cwd = check.cwd ? path.join(root, check.cwd) : root;
  const startedAt = Date.now();

  stream.write(`check=${check.id}\nlabel=${check.label}\ncwd=${cwd}\n`);
  stream.write(`command=${check.command} ${check.args.join(' ')}\n\n`);
  console.log(`\n===== ${check.id}: ${check.label} =====`);

  return await new Promise((resolve) => {
    const child = spawn(check.command, check.args, {
      cwd,
      env: { ...process.env, CI: 'true', NO_COLOR: '1', RUST_BACKTRACE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const tee = (chunk, destination) => {
      destination.write(chunk);
      stream.write(chunk);
    };

    child.stdout.on('data', (chunk) => tee(chunk, process.stdout));
    child.stderr.on('data', (chunk) => tee(chunk, process.stderr));

    child.on('error', (error) => {
      const durationMs = Date.now() - startedAt;
      stream.end(`\nspawn_error=${error.message}\nduration_ms=${durationMs}\n`);
      resolve({
        id: check.id,
        label: check.label,
        status: 'fail',
        exitCode: null,
        durationMs,
        evidence: rel(logPath),
        error: error.message,
      });
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startedAt;
      const status = code === 0 ? 'pass' : 'fail';
      stream.end(`\nstatus=${status}\nexit_code=${code}\nduration_ms=${durationMs}\n`);
      resolve({
        id: check.id,
        label: check.label,
        status,
        exitCode: code,
        durationMs,
        evidence: rel(logPath),
      });
    });
  });
}

async function runReleaseAppLiveCheck() {
  const id = 'release-app-live';
  const label = 'Exact release .app launch and process-health evidence';
  const logPath = path.join(logsDir, `${id}.log`);
  const screenshotPath = path.join(evidenceDir, 'release-app.png');
  const startedAt = Date.now();
  const lines = [`check=${id}`, `label=${label}`, `app_path=${appPath}`];
  let error = null;
  let bundleSha256 = null;
  let processEvidence = '';
  let screenshotCaptured = false;

  console.log(`\n===== ${id}: ${label} =====`);

  try {
    if (!existsSync(appPath) || !statSync(appPath).isDirectory()) {
      throw new Error(`release app was not found at ${appPath}`);
    }

    bundleSha256 = await hashDirectory(appPath);
    lines.push(`bundle_sha256=${bundleSha256}`);

    const openResult = shortCommand('open', ['-n', appPath]);
    lines.push(`open_status=${openResult.status}`);
    if (openResult.stdout.trim()) lines.push(`open_stdout=${openResult.stdout.trim()}`);
    if (openResult.stderr.trim()) lines.push(`open_stderr=${openResult.stderr.trim()}`);
    if (openResult.status !== 0) {
      throw new Error(`open failed with status ${openResult.status}`);
    }

    await sleep(15_000);

    const activateResult = shortCommand('osascript', [
      '-e',
      'tell application "Offisim" to activate',
    ]);
    lines.push(`activate_status=${activateResult.status}`);
    if (activateResult.stderr.trim()) lines.push(`activate_stderr=${activateResult.stderr.trim()}`);

    const processResult = shortCommand('pgrep', ['-fl', 'offisim-desktop']);
    processEvidence = processResult.stdout.trim();
    lines.push(`process_status=${processResult.status}`);
    lines.push(`process_evidence=${processEvidence || '<none>'}`);
    if (processResult.status !== 0 || !processEvidence) {
      throw new Error('release app process was not alive after 15 seconds');
    }

    const screenshotResult = shortCommand('screencapture', ['-x', screenshotPath]);
    screenshotCaptured =
      screenshotResult.status === 0 && existsSync(screenshotPath) && statSync(screenshotPath).size > 0;
    lines.push(`screenshot_status=${screenshotResult.status}`);
    lines.push(`screenshot_captured=${screenshotCaptured}`);
    if (screenshotResult.stderr.trim()) {
      lines.push(`screenshot_stderr=${screenshotResult.stderr.trim()}`);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    lines.push(`error=${error}`);
  } finally {
    shortCommand('osascript', ['-e', 'tell application "Offisim" to quit']);
    shortCommand('pkill', ['-f', 'offisim-desktop']);
  }

  const durationMs = Date.now() - startedAt;
  const status = error ? 'fail' : 'pass';
  lines.push(`status=${status}`, `duration_ms=${durationMs}`);
  writeFileSync(logPath, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));

  return {
    id,
    label,
    status,
    exitCode: error ? 1 : 0,
    durationMs,
    evidence: rel(logPath),
    appPath: rel(appPath),
    bundleSha256,
    processEvidence,
    screenshot: screenshotCaptured ? rel(screenshotPath) : null,
    screenshotCaptured,
    error,
  };
}

function commandOutput(command, args) {
  const result = shortCommand(command, args);
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

async function main() {
  const metadata = {
    createdAt: new Date().toISOString(),
    commit: commandOutput('git', ['rev-parse', 'HEAD']),
    branch: process.env.GITHUB_REF_NAME ?? commandOutput('git', ['branch', '--show-current']),
    runner: process.env.RUNNER_OS ?? 'unknown',
    runnerImage: process.env.ImageOS ?? 'unknown',
    evaluation: 'pass/fail; every required check must exit 0; no skipped checks',
    conditions:
      'single macOS job, Node 24, pnpm 10.15.1, Rust stable, frozen lockfile, CI=true',
  };

  for (const check of checks) {
    results.push(await runCommandCheck(check));
  }
  results.push(await runReleaseAppLiveCheck());

  const resultById = new Map(results.map((result) => [result.id, result]));
  const scenarioResults = scenarios.map((scenario) => {
    const required = scenario.checks.map((id) => resultById.get(id));
    const missing = scenario.checks.filter((id) => !resultById.has(id));
    const failed = required.filter((result) => result?.status !== 'pass').map((result) => result?.id);
    const status = missing.length === 0 && failed.length === 0 ? 'pass' : 'fail';
    return { ...scenario, status, failedChecks: [...missing, ...failed] };
  });

  const failedGlobalChecks = globalChecks.filter((id) => resultById.get(id)?.status !== 'pass');
  const failedScenarios = scenarioResults.filter((scenario) => scenario.status !== 'pass');
  const overallStatus = failedGlobalChecks.length === 0 && failedScenarios.length === 0 ? 'pass' : 'fail';

  const summary = {
    ...metadata,
    overallStatus,
    successCriteria: {
      scenarios: 'all 12 realistic scenarios pass their required checks',
      global: 'canonical validate, production audit, desktop build, and exact .app live check pass',
      evidence: 'every check has a dedicated log; release app records path, bundle hash, and process evidence',
    },
    globalChecks,
    failedGlobalChecks,
    checks: results,
    scenarios: scenarioResults,
  };

  writeFileSync(path.join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  const report = [
    '# Offisim capability QA report',
    '',
    `- Commit: \`${metadata.commit}\``,
    `- Branch: \`${metadata.branch}\``,
    `- Conditions: ${metadata.conditions}`,
    `- Evaluation: ${metadata.evaluation}`,
    `- Overall: **${overallStatus.toUpperCase()}**`,
    '',
    '## Original success criteria',
    '',
    '1. Every scenario must pass every mapped retained gate or targeted harness.',
    '2. Canonical validate, production dependency audit, desktop release build, and exact `.app` live check must all pass.',
    '3. Every check must have a dedicated log; the release app check must record the exact path, deterministic bundle hash, and live process evidence.',
    '',
    '## Scenario results',
    '',
    '| ID | Realistic scenario | Required checks | Result |',
    '|---|---|---|---|',
    ...scenarioResults.map(
      (scenario) =>
        `| ${scenario.id} | ${scenario.name} | ${scenario.checks.map((id) => `\`${id}\``).join(', ')} | **${scenario.status.toUpperCase()}** |`,
    ),
    '',
    '## Check results',
    '',
    '| Check | Result | Exit | Duration | Evidence |',
    '|---|---|---:|---:|---|',
    ...results.map(
      (result) =>
        `| \`${result.id}\` | **${result.status.toUpperCase()}** | ${result.exitCode ?? 'n/a'} | ${(result.durationMs / 1000).toFixed(1)}s | \`${result.evidence}\` |`,
    ),
    '',
    `Failed global checks: ${failedGlobalChecks.length ? failedGlobalChecks.map((id) => `\`${id}\``).join(', ') : 'none'}.`,
    `Failed scenarios: ${failedScenarios.length ? failedScenarios.map((scenario) => scenario.id).join(', ') : 'none'}.`,
    '',
  ].join('\n');

  writeFileSync(path.join(evidenceDir, 'report.md'), report);
  console.log(`\n${report}`);

  process.exitCode = overallStatus === 'pass' ? 0 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(path.join(evidenceDir, 'runner-error.log'), `${message}\n`);
  console.error(message);
  process.exitCode = 1;
});
