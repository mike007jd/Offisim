import * as XLSX from 'xlsx';
import type { ExportResult, ExportableDocument, Exporter } from './types.js';
import { formatDate, sanitizeFilename } from './utils.js';

export const csvExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');

    // Build structured rows from the document
    const rows = extractStructuredData(doc.content, {
      title: doc.title,
      date,
      contributors: contributorText,
    });

    const safeRows = rows.map((row) => row.map(neutralizeCsvFormulaCell));
    const worksheet = XLSX.utils.aoa_to_sheet(safeRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Document');

    const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8' });

    return {
      blob,
      filename: `${sanitizeFilename(doc.title)}.csv`,
      mimeType: 'text/csv',
    };
  },
};

function extractStructuredData(
  content: string,
  meta: { title: string; date: string; contributors: string },
): string[][] {
  const rows: string[][] = [];

  // Header row with metadata
  rows.push(['Document', meta.title]);
  rows.push(['Date', meta.date]);
  rows.push(['Contributors', meta.contributors]);
  rows.push([]); // blank separator
  rows.push(['Section', 'Content']);

  // Parse content into section/text pairs
  const lines = content.split('\n');
  let currentSection = 'Main';
  let sectionContent: string[] = [];

  const flushSection = () => {
    const text = sectionContent.join('\n').trim();
    if (text) {
      rows.push([currentSection, text]);
    }
    sectionContent = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+)/.exec(line);
    if (headingMatch?.[1] && headingMatch[1].length <= 2) {
      flushSection();
      currentSection = headingMatch[2] ?? line;
    } else {
      sectionContent.push(line);
    }
  }
  flushSection();

  return rows;
}

function neutralizeCsvFormulaCell(value: string): string {
  if (/^[\s]*[=+\-@]/u.test(value)) {
    return `'${value}`;
  }
  return value;
}
