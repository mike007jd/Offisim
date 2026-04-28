import { resolve } from 'node:path';
import { ensureRuntimeBuild, parseArgs } from './harness-lib.mjs';
import { ROOT } from './harness-scenario-loader.mjs';

const args = parseArgs(process.argv.slice(2));
await ensureRuntimeBuild({ force: args.forceBuild === true });

const { loadVcrFixtures } = await import(
  new URL('../packages/core/dist/testing/vcr-corpus.js', import.meta.url).href
);

const fixtureDir = resolve(ROOT, 'packages/core/harness/fixtures/llm');
const fixtures = await loadVcrFixtures(fixtureDir);
const enabled = process.env.OFFISIM_VCR === '1';
const failOnMissing = process.env.OFFISIM_VCR_FAIL_ON_MISSING === '1';

if (enabled && failOnMissing && fixtures.size === 0) {
  throw new Error(`OFFISIM_VCR_FAIL_ON_MISSING=1 but no fixtures were found in ${fixtureDir}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'vcr',
      enabled,
      failOnMissing,
      fixtureDir,
      fixtureCount: fixtures.size,
    },
    null,
    2,
  ),
);
