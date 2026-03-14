import type { ExportableDocument, ExportFormat, ExportResult, Exporter } from './types';
import { csvExporter } from './csv-exporter';
import { docxExporter } from './docx-exporter';
import { htmlExporter } from './html-exporter';
import { pdfExporter } from './pdf-exporter';
import { pptxExporter } from './pptx-exporter';
import { txtExporter } from './txt-exporter';

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
