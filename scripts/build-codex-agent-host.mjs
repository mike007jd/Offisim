import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'scripts/tauri-codex-agent-host.entry.mjs');
const OUTFILE = resolve(ROOT, 'apps/desktop/src-tauri/resources/codex-agent-host.mjs');

function loadEsbuild() {
  const requireFromWeb = createRequire(resolve(ROOT, 'apps/web/package.json'));
  const vitePackageJson = requireFromWeb.resolve('vite/package.json');
  const esbuildPackageJson = resolve(dirname(vitePackageJson), '../esbuild/package.json');
  const requireFromEsbuild = createRequire(esbuildPackageJson);
  return requireFromEsbuild('esbuild');
}

const { build } = loadEsbuild();

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
