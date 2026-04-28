import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';
import { loadHarnessScenarios } from './harness-scenario-loader.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runContextBudgetHarness } = await import(
  new URL('../packages/core/dist/testing/context-budget-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const report = await runContextBudgetHarness(loadHarnessScenarios());
console.log(JSON.stringify(report, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
