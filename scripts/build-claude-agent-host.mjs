import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-claude-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/claude-agent-host.mjs');

function loadEsbuild() {
  const requireFromWeb = createRequire(resolve(ROOT, 'apps/web/package.json'));
  const vitePackageJson = requireFromWeb.resolve('vite/package.json');
  const esbuildPackageJson = resolve(dirname(vitePackageJson), '../esbuild/package.json');
  const requireFromEsbuild = createRequire(esbuildPackageJson);
  return requireFromEsbuild('esbuild');
}

const { build } = loadEsbuild();

function formatOutfile(outfile) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'biome', 'format', '--write', '--no-errors-on-unmatched', relative(ROOT, outfile)],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Biome failed to format ${outfile}`);
  }
}

await mkdir(dirname(OUTFILE), { recursive: true });
await build({
  entryPoints: [ENTRY],
  outfile: OUTFILE,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
formatOutfile(OUTFILE);

console.log(
  JSON.stringify(
    {
      ok: true,
      outfile: OUTFILE,
    },
    null,
    2,
  ),
);
