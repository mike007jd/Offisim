// VM-005 — Executable functional-test suite runner.
//
// Runs the S1–S12 functional scenarios from
// `Docs/test-loops/codex-functional-test-loop.md`, emits a STRUCTURED
// per-scenario evidence ledger (PASS / FAIL / SKIP / INFRA_FAIL), and — this is
// the whole point — SEPARATES infrastructure failure from product failure:
//
//   - A missing Pi env (no auth.json + models.json) makes S10–S12 SKIP/infra.
//   - A missing cargo toolchain makes S7 SKIP/infra.
//   - A spawn error (ENOENT / command-not-found) is INFRA_FAIL/infra.
//   - A non-zero exit WITH captured output is a real FAIL/product.
//
// A run is "clean" iff it has ZERO product-FAIL/INFRA_FAIL states (SKIP allowed).
// The runner exits 0 on DONE (two consecutive clean iterations) or a clean
// `--once`; it exits non-zero only on a real product FAIL or a STUCK verdict
// (two consecutive iterations with the identical FAIL id-set + signatures).
//
// Per ADR Docs/architecture/2026-06-25-truth-closure.md (VM-005) and PRD VM-005.
// Today `pnpm validate` just runs harnesses serially and dies on first failure;
// this is the orchestrator that gives a per-capability, infra-aware verdict.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectPiEnv } from './live-harness-shared.mjs';

// --- Scenario table ---------------------------------------------------------
// id → tier → command (as argv) → requiresPiEnv → requiresCargo. Each command is
// run through `pnpm`/`cargo`/`node` directly (no shell) where possible; the few
// that chain with `&&` are run via the shell so the existing composite gates
// (S9) keep their exact semantics.
const SCENARIOS = [
  { id: 'S1', tier: 'headless', argv: ['pnpm', 'typecheck'] },
  { id: 'S2', tier: 'headless', argv: ['pnpm', 'harness:pi-permission'] },
  { id: 'S3', tier: 'headless', argv: ['pnpm', 'harness:conversation-run-controller'] },
  { id: 'S4', tier: 'headless', argv: ['pnpm', 'check:pi-wire-contract'] },
  { id: 'S5', tier: 'headless', argv: ['pnpm', 'harness:pi-agent-host'] },
  { id: 'S6', tier: 'headless', argv: ['pnpm', 'harness:studio-placement'] },
  {
    id: 'S7',
    tier: 'headless',
    requiresCargo: true,
    argv: ['cargo', 'test', '--locked'],
    cwd: 'apps/desktop/src-tauri',
  },
  { id: 'S8', tier: 'headless', argv: ['pnpm', 'security:harness'] },
  {
    id: 'S9',
    tier: 'headless',
    shell:
      'pnpm check:deadcode && pnpm check:ui-hygiene && pnpm audit --prod --audit-level high && pnpm harness:chat-attachment-roundtrip && pnpm harness:doc-engine',
  },
  {
    id: 'S10',
    tier: 'live',
    requiresPiEnv: true,
    argv: ['node', 'scripts/harness-live-agent-run.mjs'],
  },
  {
    id: 'S11',
    tier: 'live',
    requiresPiEnv: true,
    argv: ['node', 'scripts/harness-live-auto-gate.mjs'],
  },
  {
    id: 'S12',
    tier: 'live',
    requiresPiEnv: true,
    argv: ['node', 'scripts/harness-live-ask-gate.mjs'],
  },
];

const RESULTS_DIR = 'test-loop';
const RESULTS_FILE = join(RESULTS_DIR, 'results.jsonl');
const REPORT_FILE = join(RESULTS_DIR, 'report.md');

// --- CLI args ---------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    once: false,
    iterations: 2,
    maxIterations: 6,
    scenarios: null, // null = all
  };
  for (const arg of argv) {
    if (arg === '--once') opts.once = true;
    else if (arg.startsWith('--iterations=')) opts.iterations = Number(arg.split('=')[1]);
    else if (arg === '--iterations') {
      // tolerate space form
      opts.iterations = Number(argv[argv.indexOf(arg) + 1]);
    } else if (arg.startsWith('--max-iterations=')) opts.maxIterations = Number(arg.split('=')[1]);
    else if (arg.startsWith('--scenarios=')) {
      opts.scenarios = arg
        .split('=')[1]
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }
  }
  if (!Number.isFinite(opts.iterations) || opts.iterations < 1) opts.iterations = 2;
  if (!Number.isFinite(opts.maxIterations) || opts.maxIterations < 1) opts.maxIterations = 6;
  return opts;
}

// --- env fingerprint --------------------------------------------------------
function gitCommit() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function cargoPresent() {
  const r = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function envFingerprint() {
  const pi = detectPiEnv();
  return {
    gitCommit: gitCommit(),
    node: process.version,
    piEnv: pi.configured,
    cargo: cargoPresent(),
  };
}

// --- signature --------------------------------------------------------------
// A short, stable failure signature: scenario id + a hash of the first non-empty
// stderr (falling back to stdout) line. STUCK detection compares these across
// iterations, so it must be deterministic for an identical failure.
function failureSignature(scenarioId, stdout, stderr) {
  const source = stderr?.trim() || stdout?.trim() || '';
  const firstLine = source.split('\n').find((line) => line.trim()) ?? '';
  const hash = createHash('sha1').update(firstLine).digest('hex').slice(0, 10);
  return `${scenarioId}:${hash}`;
}

// --- single scenario run ----------------------------------------------------
function runScenario(scenario, iter, fingerprint) {
  const evidenceDir = join(RESULTS_DIR, 'evidence', `iter-${iter}`);
  mkdirSync(evidenceDir, { recursive: true });
  const evidenceRel = join(evidenceDir, `${scenario.id}.log`);

  // Pre-flight infra SKIPs — never spawn when the prerequisite is absent.
  if (scenario.requiresPiEnv && !fingerprint.piEnv) {
    // The live harnesses self-detect this too, but skipping the spawn keeps the
    // "no Pi env" path bullet-proof (no chance of a host crash).
    return finalize(scenario, {
      state: 'SKIP',
      classification: 'infra',
      exitCode: 0,
      durationMs: 0,
      evidenceRel,
      signature: null,
      stdout: '',
      stderr: 'pi env not configured (auth.json + models.json absent) — skipped',
    });
  }
  if (scenario.requiresCargo && !fingerprint.cargo) {
    return finalize(scenario, {
      state: 'SKIP',
      classification: 'infra',
      exitCode: 0,
      durationMs: 0,
      evidenceRel,
      signature: null,
      stdout: '',
      stderr: 'cargo not on PATH — skipped',
    });
  }

  const started = Date.now();
  let result;
  if (scenario.shell) {
    result = spawnSync(scenario.shell, {
      shell: true,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      cwd: scenario.cwd ?? process.cwd(),
    });
  } else {
    const [cmd, ...args] = scenario.argv;
    result = spawnSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      cwd: scenario.cwd ?? process.cwd(),
    });
  }
  const durationMs = Date.now() - started;

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  // Spawn-level error (ENOENT / command-not-found) → INFRA_FAIL/infra. spawnSync
  // sets `.error` on a spawn failure; status is null in that case.
  if (result.error) {
    const message =
      result.error.code === 'ENOENT'
        ? `command not found: ${scenario.argv?.[0] ?? scenario.shell}`
        : String(result.error.message ?? result.error);
    return finalize(scenario, {
      state: 'INFRA_FAIL',
      classification: 'infra',
      exitCode: -1,
      durationMs,
      evidenceRel,
      signature: failureSignature(scenario.id, stdout, message),
      stdout,
      stderr: `${stderr}\n[spawn error] ${message}`,
    });
  }

  const exitCode = result.status ?? -1;

  // Live harnesses emit a final stdout JSON verdict line; prefer it over the
  // exit code. SKIP → infra; FAIL → product; PASS → pass.
  if (scenario.tier === 'live') {
    const verdict = lastQaVerdict(stdout);
    if (verdict?.qaState === 'SKIP') {
      return finalize(scenario, {
        state: 'SKIP',
        classification: 'infra',
        exitCode,
        durationMs,
        evidenceRel,
        signature: null,
        stdout,
        stderr,
      });
    }
    if (verdict?.qaState === 'PASS') {
      return finalize(scenario, {
        state: 'PASS',
        classification: null,
        exitCode,
        durationMs,
        evidenceRel,
        signature: null,
        stdout,
        stderr,
      });
    }
    if (verdict?.qaState === 'FAIL') {
      return finalize(scenario, {
        state: 'FAIL',
        classification: 'product',
        exitCode: exitCode === 0 ? 1 : exitCode,
        durationMs,
        evidenceRel,
        signature: failureSignature(scenario.id, stdout, verdict.reason ?? stderr),
        stdout,
        stderr,
      });
    }
    // No verdict line at all from a live harness → treat a non-zero exit as a
    // product FAIL, a zero exit (unexpected) as a product FAIL too (it should
    // always emit a verdict). Fall through to the generic exit-code path below.
  }

  if (exitCode === 0) {
    return finalize(scenario, {
      state: 'PASS',
      classification: null,
      exitCode,
      durationMs,
      evidenceRel,
      signature: null,
      stdout,
      stderr,
    });
  }

  // Non-zero exit with captured output → real product FAIL.
  return finalize(scenario, {
    state: 'FAIL',
    classification: 'product',
    exitCode,
    durationMs,
    evidenceRel,
    signature: failureSignature(scenario.id, stdout, stderr),
    stdout,
    stderr,
  });
}

/** The last `{"qaState":...}` JSON object printed on stdout, if any. */
function lastQaVerdict(stdout) {
  let verdict = null;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.includes('qaState')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.qaState === 'string') verdict = parsed;
    } catch {
      // ignore non-JSON noise
    }
  }
  return verdict;
}

function finalize(scenario, record) {
  // Write the per-scenario evidence log (stdout + stderr).
  const evidenceAbs = join(process.cwd(), record.evidenceRel);
  const body =
    `# ${scenario.id} — ${record.state} (${record.classification ?? 'n/a'})\n` +
    `# command: ${scenario.shell ?? scenario.argv.join(' ')}\n` +
    `# exitCode: ${record.exitCode}  durationMs: ${record.durationMs}\n\n` +
    `===== STDOUT =====\n${record.stdout}\n\n===== STDERR =====\n${record.stderr}\n`;
  writeFileSync(evidenceAbs, body);
  return {
    scenario: scenario.id,
    tier: scenario.tier,
    state: record.state,
    classification: record.classification,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    evidenceFile: record.evidenceRel,
    signature: record.signature,
  };
}

// --- iteration --------------------------------------------------------------
function runIteration(scenarios, iter, fingerprint) {
  const rows = [];
  for (const scenario of scenarios) {
    process.stderr.write(`[iter ${iter}] running ${scenario.id} …\n`);
    const row = runScenario(scenario, iter, fingerprint);
    rows.push(row);
    // Append a ledger line per scenario per iteration.
    const ledgerLine = {
      iter,
      scenario: row.scenario,
      tier: row.tier,
      state: row.state,
      classification: row.classification,
      exitCode: row.exitCode,
      durationMs: row.durationMs,
      evidenceFile: row.evidenceFile,
      signature: row.signature,
      ts: new Date().toISOString(),
    };
    appendFileSync(RESULTS_FILE, `${JSON.stringify(ledgerLine)}\n`);
  }
  return rows;
}

/** A run is clean iff no row is a product-FAIL or INFRA_FAIL (SKIP allowed). */
function isClean(rows) {
  return rows.every((row) => row.state !== 'FAIL' && row.state !== 'INFRA_FAIL');
}

/** The set of failing scenario ids + their signatures, for STUCK comparison. */
function failureFingerprint(rows) {
  return rows
    .filter((row) => row.state === 'FAIL' || row.state === 'INFRA_FAIL')
    .map((row) => `${row.scenario}=${row.signature ?? ''}`)
    .sort()
    .join('|');
}

// --- reporting --------------------------------------------------------------
function renderTable(rows) {
  const header = 'scenario | state       | classification | ms';
  const sep = '-------- | ----------- | -------------- | --------';
  const lines = rows.map((row) => {
    const scen = row.scenario.padEnd(8);
    const state = row.state.padEnd(11);
    const cls = (row.classification ?? '-').padEnd(14);
    return `${scen} | ${state} | ${cls} | ${row.durationMs}`;
  });
  return [header, sep, ...lines].join('\n');
}

function writeReport(rows, verdict, fingerprint) {
  const table = renderTable(rows);
  const md = [
    '# Functional Test Loop — Report',
    '',
    `**Verdict:** ${verdict}`,
    '',
    '## Environment fingerprint',
    '',
    `- git commit: \`${fingerprint.gitCommit}\``,
    `- node: ${fingerprint.node}`,
    `- pi env present: ${fingerprint.piEnv ? 'yes' : 'no'}`,
    `- cargo present: ${fingerprint.cargo ? 'yes' : 'no'}`,
    '',
    '## Scenarios',
    '',
    '```',
    table,
    '```',
    '',
  ].join('\n');
  writeFileSync(join(process.cwd(), REPORT_FILE), md);
}

// --- main -------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fingerprint = envFingerprint();

  const scenarios = opts.scenarios
    ? SCENARIOS.filter((s) => opts.scenarios.includes(s.id))
    : SCENARIOS;

  if (scenarios.length === 0) {
    process.stderr.write(`No scenarios matched ${JSON.stringify(opts.scenarios)}\n`);
    process.exit(2);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  // Fresh ledger each invocation so the JSONL reflects this run only.
  writeFileSync(RESULTS_FILE, '');

  let lastRows = [];
  let cleanStreak = 0;
  let prevFailureFp = null;
  let verdict = null;

  const maxIters = opts.once ? 1 : opts.maxIterations;

  for (let iter = 0; iter < maxIters; iter += 1) {
    const rows = runIteration(scenarios, iter, fingerprint);
    lastRows = rows;
    const clean = isClean(rows);

    if (opts.once) {
      verdict = clean ? 'DONE (single pass, clean)' : 'FAIL (product failure on single pass)';
      break;
    }

    if (clean) {
      cleanStreak += 1;
      prevFailureFp = null;
      if (cleanStreak >= opts.iterations) {
        verdict = `DONE (${opts.iterations} consecutive clean iterations)`;
        break;
      }
    } else {
      cleanStreak = 0;
      const fp = failureFingerprint(rows);
      if (prevFailureFp !== null && fp === prevFailureFp) {
        verdict = 'STUCK (identical failure signature set across two consecutive iterations)';
        break;
      }
      prevFailureFp = fp;
    }
  }

  if (verdict === null) {
    // Loop exhausted maxIterations without converging.
    verdict = `STUCK (reached max iterations ${opts.maxIterations} without two consecutive clean runs)`;
  }

  writeReport(lastRows, verdict, fingerprint);

  // Console output: the table + verdict.
  process.stdout.write('\n');
  process.stdout.write(renderTable(lastRows));
  process.stdout.write('\n\n');
  process.stdout.write(`Verdict: ${verdict}\n`);
  process.stdout.write(
    `Env: commit ${fingerprint.gitCommit}, node ${fingerprint.node}, pi-env ${fingerprint.piEnv ? 'yes' : 'no'}, cargo ${fingerprint.cargo ? 'yes' : 'no'}\n`,
  );

  const ok = verdict.startsWith('DONE');
  process.exit(ok ? 0 : 1);
}

main();
