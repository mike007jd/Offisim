import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';

export function loadEsbuild(root) {
  const requireFromRenderer = createRequire(resolve(root, 'apps/desktop/renderer/package.json'));
  const vitePackageJson = requireFromRenderer.resolve('vite/package.json');
  const esbuildPackageJson = resolve(dirname(vitePackageJson), '../esbuild/package.json');
  const requireFromEsbuild = createRequire(esbuildPackageJson);
  return requireFromEsbuild('esbuild');
}

const MAX_BIOME_FORMAT_BYTES = 1_000_000;

export async function formatOutfile(outfile, root) {
  const { size } = await stat(outfile);
  if (size > MAX_BIOME_FORMAT_BYTES) return;

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

const GENERATED_CONST_NAMES = [
  'MAX_CODEX_TEXT_BYTES',
  'MAX_CODEX_REASONING_BYTES',
  'MAX_CODEX_RUNTIME_EVENTS',
  'MAX_CODEX_APP_SERVER_STDERR_BYTES',
  'TRUNCATED_SUFFIX',
  'STDERR_TRUNCATED_PREFIX',
];

async function normalizeGeneratedConstants(outfile) {
  let text = await readFile(outfile, 'utf8');
  const before = text;
  for (const name of GENERATED_CONST_NAMES) {
    text = text.replace(new RegExp(`^var ${name} =`, 'm'), `const ${name} =`);
  }
  if (text !== before) {
    await writeFile(outfile, text);
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
    target: ['node22'],
    sourcemap: false,
    legalComments: 'none',
    banner: {
      js: [
        '#!/usr/bin/env node',
        'import { createRequire as __offisimCreateRequire } from "node:module";',
        'const require = __offisimCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });
  await normalizeGeneratedConstants(outfile);
  await formatOutfile(outfile, root);
}
