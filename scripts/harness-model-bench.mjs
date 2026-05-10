import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadHarnessScenarios } from './harness-scenario-loader.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runDeterministicModelBench } = await import(
  new URL('../packages/core/dist/testing/model-bench-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const report = await runDeterministicModelBench(loadHarnessScenarios());
const output = { ...report, mode: args.quick ? 'quick' : 'default' };
const reportFile = args.reportFile ?? args['report-file'];
if (typeof reportFile === 'string' && reportFile.trim().length > 0) {
  writeFileSync(resolve(reportFile), `${JSON.stringify(output, null, 2)}\n`);
}
console.log(JSON.stringify(output, null, 2));
process.exit(
  report.cases.every((testCase) => testCase.passed) &&
    report.routeComparisons.every((testCase) => testCase.gateSatisfied)
    ? 0
    : 1,
);
