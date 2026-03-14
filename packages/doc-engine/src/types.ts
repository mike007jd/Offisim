/**
 * A document ready for export. Created from runtime deliverables.
 */
export interface ExportableDocument {
  title: string;
  /** Markdown or plain text content */
  content: string;
  contributors: { name: string }[];
  createdAt: number;
  metadata?: Record<string, string>;
}

export type ExportFormat = 'docx' | 'pdf' | 'pptx' | 'csv' | 'html' | 'txt';

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Contract for a format-specific exporter.
 */
export interface Exporter {
  export(doc: ExportableDocument): Promise<ExportResult>;
}
