#!/usr/bin/env node
/**
 * Copy `pdf.worker.min.mjs` from the installed `pdfjs-dist` legacy build into
 * `apps/desktop/renderer/public/`. Wired into the desktop renderer `prebuild` so the file is always
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
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEST = resolve(ROOT, 'apps/desktop/renderer/public/pdf.worker.min.mjs');
const FONTS_DEST = resolve(ROOT, 'apps/desktop/renderer/public/pdfjs-standard-fonts');

const requireFromDocEngine = createRequire(resolve(ROOT, 'packages/doc-engine/package.json'));
const pdfjsPkg = requireFromDocEngine.resolve('pdfjs-dist/package.json');
const SRC = resolve(dirname(pdfjsPkg), 'legacy/build/pdf.worker.min.mjs');
const FONTS_SRC = resolve(dirname(pdfjsPkg), 'standard_fonts');

if (!existsSync(SRC) || !existsSync(FONTS_SRC)) {
  console.error(`[copy-pdf-worker] source missing: ${SRC}`);
  process.exit(1);
}

let workerUpToDate = false;
if (existsSync(DEST)) {
  const srcStat = statSync(SRC);
  const destStat = statSync(DEST);
  if (srcStat.size === destStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
    workerUpToDate = true;
  }
}

mkdirSync(dirname(DEST), { recursive: true });
if (workerUpToDate) {
  console.log('[copy-pdf-worker] worker up-to-date, skipped');
} else {
  copyFileSync(SRC, DEST);
  console.log(`[copy-pdf-worker] copied ${SRC} -> ${DEST}`);
}
rmSync(FONTS_DEST, { recursive: true, force: true });
cpSync(FONTS_SRC, FONTS_DEST, { recursive: true });
console.log(`[copy-pdf-worker] copied ${FONTS_SRC} -> ${FONTS_DEST}`);
