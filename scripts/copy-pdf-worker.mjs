#!/usr/bin/env node
/**
 * Copy `pdf.worker.min.mjs` from the installed `pdfjs-dist` legacy build into
 * `apps/web/public/`. Wired into `apps/web` `prebuild` so the file is always
 * available as a vite static asset at `/pdf.worker.min.mjs`.
 *
 * The Tauri release `.app` ships the same web bundle (loaded from
 * `tauri://localhost/`), so the copy doubles as the desktop worker source —
 * no separate `apps/desktop/src-tauri/resources/` copy is required for the v1
 * deployment.
 *
 * Idempotent — a fresh copy each prebuild keeps the bytes in sync with whatever
 * `pdfjs-dist` version is currently installed.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEST = resolve(ROOT, 'apps/web/public/pdf.worker.min.mjs');

const requireFromDocEngine = createRequire(resolve(ROOT, 'packages/doc-engine/package.json'));
const pdfjsPkg = requireFromDocEngine.resolve('pdfjs-dist/package.json');
const SRC = resolve(dirname(pdfjsPkg), 'legacy/build/pdf.worker.min.mjs');

if (!existsSync(SRC)) {
  console.error(`[copy-pdf-worker] source missing: ${SRC}`);
  process.exit(1);
}

if (existsSync(DEST)) {
  const srcStat = statSync(SRC);
  const destStat = statSync(DEST);
  if (srcStat.size === destStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
    console.log('[copy-pdf-worker] up-to-date, skipped');
    process.exit(0);
  }
}

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);
console.log(`[copy-pdf-worker] copied ${SRC} -> ${DEST}`);
