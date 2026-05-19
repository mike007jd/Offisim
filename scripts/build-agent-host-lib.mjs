import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';

export function loadEsbuild(root) {
  const requireFromRenderer = createRequire(resolve(root, 'apps/desktop/renderer/package.json'));
  const vitePackageJson = requireFromRenderer.resolve('vite/package.json');
  const esbuildPackageJson = resolve(dirname(vitePackageJson), '../esbuild/package.json');
  const requireFromEsbuild = createRequire(esbuildPackageJson);
  return requireFromEsbuild('esbuild');
}

export function formatOutfile(outfile, root) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'biome', 'format', '--write', '--no-errors-on-unmatched', relative(root, outfile)],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Biome failed to format ${outfile}`);
  }
}

export async function buildAgentHost({ root, entry, outfile }) {
  const { build } = loadEsbuild(root);
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    sourcemap: false,
    legalComments: 'none',
    banner: { js: '#!/usr/bin/env node' },
  });
  formatOutfile(outfile, root);
}
