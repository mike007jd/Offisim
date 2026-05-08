import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runMcpLifecycleHarness } = await import(
  new URL('../packages/core/dist/testing/mcp-lifecycle-runner.js', import.meta.url).href
);

const report = await runMcpLifecycleHarness();
console.log(JSON.stringify(report, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
