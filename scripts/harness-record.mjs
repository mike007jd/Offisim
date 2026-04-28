import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';
import { ROOT, loadHarnessScenarios } from './harness-scenario-loader.mjs';

if (process.env.OFFISIM_VCR_RECORD !== '1') {
  throw new Error('Refusing to record VCR corpus without OFFISIM_VCR_RECORD=1.');
}

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runDeterministicScenario } = await import(
  new URL('../packages/core/dist/testing/scenario-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const reportDir = resolve(ROOT, 'packages/core/harness/fixtures/reports');
await mkdir(reportDir, { recursive: true });

const reports = [];
for (const scenario of loadHarnessScenarios()) {
  const report = await runDeterministicScenario(scenario);
  reports.push(report);
  await writeFile(
    resolve(reportDir, `${scenario.id}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: reports.every((report) => report.passed),
      suite: 'record',
      reportDir,
      scenarios: reports.map((report) => ({
        scenarioId: report.scenarioId,
        passed: report.passed,
        traceHash: report.traceHash,
      })),
    },
    null,
    2,
  ),
);
process.exit(reports.every((report) => report.passed) ? 0 : 1);
