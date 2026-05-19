/**
 * Resolves the runtime URL for the bundled `pdf.worker.min.mjs`. We bias toward
 * a real worker (off-thread parsing) but tolerate falling back to the pdfjs
 * fakeWorker (synchronous main-thread) when no platform-correct URL is known.
 *
 * Bundling contract: `scripts/copy-pdf-worker.mjs` copies the worker to
 * `apps/desktop/renderer/public/pdf.worker.min.mjs`, served at
 * `/pdf.worker.min.mjs` inside the Tauri WebView. No Tauri-specific
 * `convertFileSrc` is required for the v1 deployment.
 *
 * Callers (`pdf.ts`) wire the result into `pdfjsLib.GlobalWorkerOptions.workerSrc`
 * exactly once per process. Returning `null` lets pdfjs fall back to its
 * fakeWorker, which is the safe default for Node tests / harness scenarios.
 */
export function resolvePdfWorkerSrc(): string | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return '/pdf.worker.min.mjs';
}
