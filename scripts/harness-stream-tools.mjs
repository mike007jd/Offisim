import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runStreamingToolParityHarness } = await import(
  new URL('../packages/core/dist/testing/streaming-tool-runner.js', import.meta.url).href
);

const report = await runStreamingToolParityHarness();
console.log(JSON.stringify(report, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
