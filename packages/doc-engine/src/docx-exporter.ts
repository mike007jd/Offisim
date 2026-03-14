import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { ExportableDocument, ExportResult, Exporter } from './types';
import { sanitizeFilename, formatDate, splitContentBlocks } from './utils';

export const docxExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');

    const children: Paragraph[] = [];

    // Title
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: doc.title, bold: true, size: 48 })],
      }),
    );

    // Metadata line
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: `${date}  |  Contributors: ${contributorText || 'N/A'}`,
            size: 20,
            color: '666666',
          }),
        ],
      }),
    );

    // Separator
    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

    // Content blocks
    const blocks = splitContentBlocks(doc.content);
    for (const block of blocks) {
      if (block.startsWith('# ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: block.slice(2), bold: true })],
          }),
        );
      } else if (block.startsWith('## ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: block.slice(3), bold: true })],
          }),
        );
      } else if (block.startsWith('### ')) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: block.slice(4), bold: true })],
          }),
        );
      } else {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: block, size: 24 })],
          }),
        );
      }
    }

    const document = new Document({
      sections: [{ children }],
    });

    const buffer = await Packer.toBlob(document);
    return {
      blob: buffer,
      filename: `${sanitizeFilename(doc.title)}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  },
};
