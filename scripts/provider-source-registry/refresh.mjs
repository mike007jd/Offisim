import { resolve } from 'node:path';
import {
  CATALOG_DIR,
  refreshProviderSourceRegistry,
  writeProviderSourceRegistryArtifacts,
} from './lib/catalog.mjs';
import { parseArgs } from './lib/cli-args.mjs';

const args = parseArgs(process.argv.slice(2));
const catalogDir = args['catalog-dir'] ? resolve(process.cwd(), args['catalog-dir']) : CATALOG_DIR;
const fixtureDir = args['fixture-dir'] ? resolve(process.cwd(), args['fixture-dir']) : undefined;

const artifacts = await refreshProviderSourceRegistry({
  catalogDir,
  ...(fixtureDir ? { fixtureDir } : {}),
});
await writeProviderSourceRegistryArtifacts({ catalogDir, artifacts });

console.log(
  JSON.stringify(
    {
      ok: true,
      catalogDir,
      generatedAt: artifacts.mergedCatalog.generatedAt,
      summary: artifacts.diffReport.summary,
    },
    null,
    2,
  ),
);
