/**
 * Shared utilities for doc-engine exporters.
 */

/** Sanitize a document title into a safe filename. */
export function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 100) || 'document';
}

/** Format a timestamp to a human-readable date string. */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Split content into logical blocks by blank lines and headings.
 * Each block is either a heading line or a paragraph of text.
 */
export function splitContentBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      flush();
      blocks.push(line);
    } else if (line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}
