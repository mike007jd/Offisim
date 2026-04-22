import { resolve } from 'node:path';
import {
  CATALOG_DIR,
  refreshProviderSourceRegistry,
  writeProviderSourceRegistryArtifacts,
} from './lib/catalog.mjs';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
      continue;
    }
    parsed[key] = 'true';
  }
  return parsed;
}

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
