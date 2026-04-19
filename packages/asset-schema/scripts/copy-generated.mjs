#!/usr/bin/env node
/**
 * Post-tsc: copy the generated standalone validator artifacts from src/ into
 * dist/ so downstream consumers importing `@offisim/asset-schema/dist/...`
 * find the runtime JS + type declarations. tsc itself only emits .ts→.js and
 * does not copy ambient .d.ts or .js files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

const pairs = [
  ['src/schema/manifest-validator.generated.js', 'dist/schema/manifest-validator.generated.js'],
  ['src/schema/manifest-validator.generated.d.ts', 'dist/schema/manifest-validator.generated.d.ts'],
];

for (const [from, to] of pairs) {
  const fromAbs = path.resolve(pkgRoot, from);
  const toAbs = path.resolve(pkgRoot, to);
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.copyFileSync(fromAbs, toAbs);
  console.log(`[asset-schema] copied ${from} → ${to}`);
}
