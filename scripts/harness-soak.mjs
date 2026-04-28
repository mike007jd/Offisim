import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';
import {
  SOAK_SCENARIO_IDS,
  loadHarnessScenarios,
  parseDurationMs,
  parsePositiveInt,
} from './harness-scenario-loader.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runSoakHarness } = await import(
  new URL('../packages/core/dist/testing/soak-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const scenarioIds = args.scenario ? String(args.scenario).split(',') : SOAK_SCENARIO_IDS;
const report = await runSoakHarness(loadHarnessScenarios(scenarioIds), {
  iterations: parsePositiveInt(args.iterations, 100),
  concurrency: parsePositiveInt(args.concurrency, 1),
  durationMs: parseDurationMs(args.duration),
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
