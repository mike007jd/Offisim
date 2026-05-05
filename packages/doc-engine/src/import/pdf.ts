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

export async function parsePdf(bytes: Uint8Array): Promise<ParsedAttachment> {
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
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
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
    };
  } finally {
    await doc.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}
