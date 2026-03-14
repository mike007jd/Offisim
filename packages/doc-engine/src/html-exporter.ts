import type { ExportableDocument, ExportResult, Exporter } from './types';
import { sanitizeFilename, formatDate, splitContentBlocks } from './utils';

export const htmlExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');

    const bodyHtml = splitContentBlocks(doc.content)
      .map((block) => {
        if (block.startsWith('### '))
          return `<h3>${escapeHtml(block.slice(4))}</h3>`;
        if (block.startsWith('## '))
          return `<h2>${escapeHtml(block.slice(3))}</h2>`;
        if (block.startsWith('# '))
          return `<h1>${escapeHtml(block.slice(2))}</h1>`;
        return `<p>${escapeHtml(block)}</p>`;
      })
      .join('\n    ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 24px;
      color: #1a1a1a;
      line-height: 1.7;
    }
    .title { font-size: 2em; font-weight: 700; margin-bottom: 8px; }
    .meta { color: #666; font-size: 0.85em; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e0e0e0; }
    h1 { font-size: 1.6em; margin: 24px 0 8px; }
    h2 { font-size: 1.3em; margin: 20px 0 6px; }
    h3 { font-size: 1.1em; margin: 16px 0 4px; }
    p { margin: 8px 0; }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(doc.title)}</div>
  <div class="meta">${escapeHtml(date)} &nbsp;|&nbsp; Contributors: ${escapeHtml(contributorText || 'N/A')}</div>
  <div class="content">
    ${bodyHtml}
  </div>
</body>
</html>`;

    return {
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      filename: `${sanitizeFilename(doc.title)}.html`,
      mimeType: 'text/html',
    };
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
