import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runChaosHarness } = await import(
  new URL('../packages/core/dist/testing/chaos-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});

const report = await runChaosHarness();
console.log(JSON.stringify({ ...report, mode: args.quick ? 'quick' : 'default' }, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
