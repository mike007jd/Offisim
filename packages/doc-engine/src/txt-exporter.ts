import type { ExportResult, ExportableDocument, Exporter } from './types.js';
import { formatDate, sanitizeFilename } from './utils.js';

export const txtExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');

    const text = [
      doc.title,
      '='.repeat(doc.title.length),
      '',
      `Date: ${date}`,
      `Contributors: ${contributorText || 'N/A'}`,
      '',
      '---',
      '',
      doc.content,
    ].join('\n');

    return {
      blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
      filename: `${sanitizeFilename(doc.title)}.txt`,
      mimeType: 'text/plain',
    };
  },
};
