import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ExportResult, ExportableDocument, Exporter } from './types.js';
import { formatDate, sanitizeFilename, splitContentBlocks } from './utils.js';

const PAGE_WIDTH = 595; // A4
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LINE_HEIGHT = 16;
const MAX_TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const pdfExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;
    let pageNum = 1;

    const addPageNumber = () => {
      page.drawText(`${pageNum}`, {
        x: PAGE_WIDTH / 2 - 5,
        y: 20,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
    };

    const ensureSpace = (needed: number) => {
      if (y - needed < MARGIN + 20) {
        addPageNumber();
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        pageNum++;
        y = PAGE_HEIGHT - MARGIN;
      }
    };

    // Title (wrap long titles across multiple lines)
    const titleSize = 22;
    const titleLines = wrapText(doc.title, fontBold, titleSize, MAX_TEXT_WIDTH);
    for (const titleLine of titleLines) {
      const titleLineWidth = fontBold.widthOfTextAtSize(titleLine, titleSize);
      ensureSpace(titleSize + 4);
      page.drawText(titleLine, {
        x: Math.max(MARGIN, (PAGE_WIDTH - titleLineWidth) / 2),
        y,
        size: titleSize,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= titleSize + 4;
    }
    y -= 8;

    // Metadata
    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');
    const meta = `${date}  |  Contributors: ${contributorText || 'N/A'}`;
    const metaSize = 9;
    const metaWidth = font.widthOfTextAtSize(meta, metaSize);
    page.drawText(meta, {
      x: Math.max(MARGIN, (PAGE_WIDTH - metaWidth) / 2),
      y,
      size: metaSize,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= metaSize + 20;

    // Separator line
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 20;

    // Content
    const blocks = splitContentBlocks(doc.content);
    for (const block of blocks) {
      let textFont = font;
      let textSize = 11;
      let textColor = rgb(0.15, 0.15, 0.15);

      if (block.startsWith('### ')) {
        textFont = fontBold;
        textSize = 13;
      } else if (block.startsWith('## ')) {
        textFont = fontBold;
        textSize = 15;
      } else if (block.startsWith('# ')) {
        textFont = fontBold;
        textSize = 18;
        textColor = rgb(0.1, 0.1, 0.1);
      }

      const displayText = block.replace(/^#{1,3}\s+/, '');
      const lines = wrapText(displayText, textFont, textSize, MAX_TEXT_WIDTH);

      for (const line of lines) {
        ensureSpace(LINE_HEIGHT);
        page.drawText(line, {
          x: MARGIN,
          y,
          size: textSize,
          font: textFont,
          color: textColor,
        });
        y -= LINE_HEIGHT;
      }
      y -= 6; // paragraph gap
    }

    addPageNumber();

    const pdfBytes = await pdfDoc.save();
    return {
      blob: new Blob([pdfBytes as unknown as ArrayBuffer], { type: 'application/pdf' }),
      filename: `${sanitizeFilename(doc.title)}.pdf`,
      mimeType: 'application/pdf',
    };
  },
};

/**
 * Naive word-wrap for pdf-lib (no built-in text layout).
 */
function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    // Force-break a single word that exceeds maxWidth (e.g. long URLs)
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let remaining = word;
      while (remaining.length > 0) {
        // Binary search for the longest prefix that fits within maxWidth
        let lo = 1;
        let hi = remaining.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (font.widthOfTextAtSize(remaining.slice(0, mid), size) <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        lines.push(remaining.slice(0, lo));
        remaining = remaining.slice(lo);
      }
      continue;
    }
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push('');
  return lines;
}
