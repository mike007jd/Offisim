import { csvExporter } from './csv-exporter.js';
import { docxExporter } from './docx-exporter.js';
import { htmlExporter } from './html-exporter.js';
import { pdfExporter } from './pdf-exporter.js';
import { pptxExporter } from './pptx-exporter.js';
import { txtExporter } from './txt-exporter.js';
import type { ExportFormat, ExportResult, ExportableDocument, Exporter } from './types.js';

const exporters: Record<ExportFormat, Exporter> = {
  csv: csvExporter,
  docx: docxExporter,
  html: htmlExporter,
  pdf: pdfExporter,
  pptx: pptxExporter,
  txt: txtExporter,
};

/**
 * Export a document to the specified format.
 *
 * @param doc - The document to export
 * @param format - Target format (docx, pdf, pptx, csv, html, txt)
 * @returns Export result with blob, filename, and MIME type
 */
export async function exportDocument(
  doc: ExportableDocument,
  format: ExportFormat,
): Promise<ExportResult> {
  const exporter = exporters[format];
  if (!exporter) {
    throw new Error(`Unsupported export format: ${format as string}`);
  }
  return exporter.export(doc);
}
