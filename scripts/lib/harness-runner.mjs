/**
 * Shared harness runner for scripts/harness-*.{mjs,mts}.
 *
 * Single source of truth for the check/report skeleton that was previously
 * copy-pasted into every harness (56+ local `check()` definitions). Output
 * format is byte-compatible with the legacy skeletons (`  ✓ name` /
 * `  ✗ name — detail`) so migrated harnesses produce identical logs.
 *
 * Usage (sync assertions):
 *   import { createHarness } from './lib/harness-runner.mjs';
 *   const h = createHarness('beat composer gate');
 *   h.check('name', condition, 'optional detail');
 *   h.report();
 *
 * Usage (async assertions):
 *   await h.checkAsync('name', async () => { ... throw to fail ... });
 *
 * Contract:
 * - `report()` MUST be the last call; it prints the summary and sets
 *   `process.exitCode` (never calls `process.exit`, so pending async work
 *   and stdout flushing are safe).
 * - A harness that throws outside `checkAsync` still fails: `createHarness`
 *   installs a safety-net exitCode via `beforeExit` until `report()` runs.
 */
import { fileURLToPath } from 'node:url';

/** Absolute repo root (scripts/lib/ -> repo). */
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Recursively freeze a fixture object graph.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(/** @type {Record<string, unknown>} */ (value)[key]);
    }
  }
  return value;
}

/**
 * @param {string} [title] Printed once as the harness banner.
 */
export function createHarness(title) {
  let checks = 0;
  let failures = 0;
  let reported = false;

  if (title) console.log(title);

  const safetyNet = () => {
    if (!reported) {
      console.error('  ✗ harness ended without report() — treating as failure');
      process.exitCode = 1;
    }
  };
  process.once('beforeExit', safetyNet);

  /**
   * @param {string} name
   * @param {boolean} condition
   * @param {string} [detail]
   */
  function check(name, condition, detail) {
    checks += 1;
    if (condition) {
      console.log(`  ✓ ${name}`);
    } else {
      failures += 1;
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }

  /**
   * @param {string} name
   * @param {() => unknown | Promise<unknown>} run Throw (or reject) to fail.
   */
  async function checkAsync(name, run) {
    checks += 1;
    try {
      await run();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failures += 1;
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(`  ✗ ${name}\n    ${detail.split('\n').join('\n    ')}`);
    }
  }

  /** @param {string} label */
  function section(label) {
    console.log(`\n${label}`);
  }

  /** Prints the summary line and sets the process exit code. */
  function report() {
    reported = true;
    process.removeListener('beforeExit', safetyNet);
    if (failures > 0) {
      console.error(`\n${failures}/${checks} checks failed`);
      process.exitCode = 1;
    } else {
      console.log(`\nall ${checks} checks passed`);
      process.exitCode = 0;
    }
    return failures === 0;
  }

  return {
    check,
    checkAsync,
    section,
    report,
    get checks() {
      return checks;
    },
    get failures() {
      return failures;
    },
  };
}
