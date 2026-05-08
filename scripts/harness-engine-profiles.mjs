import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { runEngineProfileHarness } = await import(
  new URL('../packages/core/dist/testing/engine-profile-runner.js', import.meta.url).href
);

const report = await runEngineProfileHarness();
console.log(JSON.stringify(report, null, 2));
process.exit(report.failed === 0 ? 0 : 1);
