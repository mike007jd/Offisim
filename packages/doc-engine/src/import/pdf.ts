import type { ParsedAttachment } from '@offisim/shared-types';
import { resolvePdfWorkerSrc } from './worker-resolver.js';

let workerConfigured = false;

async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  // legacy build is the cross-env entry (Node + browser webview compatible).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!workerConfigured) {
    const src = resolvePdfWorkerSrc();
    if (src) {
      pdfjs.GlobalWorkerOptions.workerSrc = src;
    }
    workerConfigured = true;
  }
  return pdfjs;
}

export async function parsePdf(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ParsedAttachment> {
  if (signal?.aborted) {
    return { kind: 'unsupported', reason: 'aborted' };
  }
  const pdfjs = await loadPdfjs();
  // copy into a fresh buffer because pdfjs takes ownership of the underlying
  // ArrayBuffer (it transfers it to the worker), which would null-out the
  // caller's view.
  const data = new Uint8Array(bytes);
  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;
  try {
    // Clamp pages: a hostile/huge PDF (tens of thousands of pages) would
    // otherwise extract text from every page and blow up memory/CPU.
    const MAX_PDF_PAGES = 500;
    const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);
    const truncated = doc.numPages > MAX_PDF_PAGES;
    const pages: string[] = [];
    for (let i = 1; i <= pageCount; i += 1) {
      // Per-page cancellation: a multi-hundred-page PDF can take seconds to
      // extract; bail between pages so an aborted run releases the worker
      // promptly instead of churning through every remaining page.
      if (signal?.aborted) {
        return { kind: 'unsupported', reason: 'aborted' };
      }
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((s) => s.length > 0)
        .join(' ');
      pages.push(text);
      page.cleanup();
    }
    return {
      kind: 'pdf',
      pages,
      text: pages.join('\n\n'),
      ...(truncated ? { truncated: true } : {}),
    };
  } finally {
    await doc.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}
