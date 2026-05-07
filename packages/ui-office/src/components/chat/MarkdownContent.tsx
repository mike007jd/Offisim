import type { ReactNode } from 'react';

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang: string | null; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

interface MarkdownContentProps {
  content: string;
  className?: string;
}

interface KeyedText {
  id: string;
  text: string;
}

interface KeyedRow {
  id: string;
  cells: string[];
}

const FENCE_RE = /^```([a-zA-Z0-9#+._-]*)\s*$/u;
const HEADING_RE = /^(#{1,3})\s+(.+)$/u;
const UL_RE = /^\s*[-*]\s+(.+)$/u;
const OL_RE = /^\s*\d+[.)]\s+(.+)$/u;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/u;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u;
const INLINE_RE =
  /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|\[\d+\])/gu;

function isTableRow(line: string): boolean {
  return line.includes('|') && line.replace(/\|/gu, '').trim().length > 0;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const codeLines: string[] = [];
      const lang = fence[1]?.trim() || null;
      index += 1;
      while (index < lines.length && !FENCE_RE.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3,
        text: heading[2]?.trim() ?? '',
      });
      index += 1;
      continue;
    }

    if (isTableRow(line) && TABLE_SEPARATOR_RE.test(lines[index + 1] ?? '')) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const ul = UL_RE.exec(line);
    if (ul) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = UL_RE.exec(lines[index] ?? '');
        if (!item) break;
        items.push(item[1]?.trim() ?? '');
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    const ol = OL_RE.exec(line);
    if (ol) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = OL_RE.exec(lines[index] ?? '');
        if (!item) break;
        items.push(item[1]?.trim() ?? '');
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const quote = BLOCKQUOTE_RE.exec(line);
    if (quote) {
      const linesInQuote: string[] = [];
      while (index < lines.length) {
        const next = BLOCKQUOTE_RE.exec(lines[index] ?? '');
        if (!next) break;
        linesInQuote.push(next[1]?.trim() ?? '');
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: linesInQuote.join(' ') });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (
        !next.trim() ||
        FENCE_RE.test(next) ||
        HEADING_RE.test(next) ||
        UL_RE.test(next) ||
        OL_RE.test(next) ||
        BLOCKQUOTE_RE.test(next) ||
        (isTableRow(next) && TABLE_SEPARATOR_RE.test(lines[index + 1] ?? ''))
      ) {
        break;
      }
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function safeHref(value: string): string | null {
  return /^(https?:\/\/|mailto:)/iu.test(value) ? value : null;
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function keyedTexts(values: string[], prefix: string): KeyedText[] {
  const seen = new Map<string, number>();
  return values.map((text) => {
    const hash = hashKey(text);
    const count = seen.get(hash) ?? 0;
    seen.set(hash, count + 1);
    return { id: `${prefix}-${hash}-${count}`, text };
  });
}

function keyedRows(rows: string[][], prefix: string): KeyedRow[] {
  const seen = new Map<string, number>();
  return rows.map((cells) => {
    const hash = hashKey(cells.join('\u001f'));
    const count = seen.get(hash) ?? 0;
    seen.set(hash, count + 1);
    return { id: `${prefix}-${hash}-${count}`, cells };
  });
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const key = `${start}-${matchIndex}`;
    const citation = /^\[(\d+)\]$/u.exec(token);
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);

    if (citation) {
      nodes.push(
        <sup
          key={key}
          className="mx-0.5 inline-flex h-4 min-w-[1.1em] cursor-default items-center justify-center rounded bg-info-muted px-1 text-[10px] font-bold text-info"
          title={`Citation ${citation[1]}`}
        >
          {citation[1]}
        </sup>,
      );
    } else if (link) {
      const href = safeHref(link[2] ?? '');
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-info underline decoration-info/40 underline-offset-2"
          >
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[0.92em] text-text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key} className="font-semibold text-text-primary">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    cursor = start + token.length;
    matchIndex += 1;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) return null;

  return (
    <div
      className={`min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere] ${className ?? ''}`}
    >
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'heading') {
          const headingClass =
            block.level === 1
              ? 'text-[15px] font-semibold'
              : block.level === 2
                ? 'text-[14px] font-semibold'
                : 'text-[13px] font-semibold';
          const HeadingTag = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return (
            <HeadingTag key={key} className={`${headingClass} mt-2 first:mt-0 text-text-primary`}>
              {renderInline(block.text)}
            </HeadingTag>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={key} className="mt-1 min-w-0 max-w-full first:mt-0">
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={key}
              className="mt-2 min-w-0 max-w-full border-l-2 border-info/40 pl-2 text-text-secondary first:mt-0"
            >
              {renderInline(block.text)}
            </blockquote>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          const ListTag = block.type;
          return (
            <ListTag
              key={key}
              className={`mt-1.5 min-w-0 max-w-full space-y-0.5 pl-4 first:mt-0 ${
                block.type === 'ul' ? 'list-disc' : 'list-decimal'
              }`}
            >
              {keyedTexts(block.items, `${key}-item`).map((item) => (
                <li key={item.id} className="min-w-0 max-w-full">
                  {renderInline(item.text)}
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.type === 'code') {
          return (
            <div
              key={key}
              className="mt-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-border-subtle"
            >
              {block.lang && (
                <div className="border-b border-border-subtle bg-surface-muted px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {block.lang}
                </div>
              )}
              <pre className="max-h-80 max-w-full overflow-auto bg-surface-elevated px-2.5 py-2 text-[12px] leading-relaxed">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        return (
          <div key={key} className="mt-2 max-w-full overflow-x-auto first:mt-0">
            <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-border-subtle text-left text-[12px]">
              <thead className="bg-surface-elevated text-text-primary">
                <tr>
                  {keyedTexts(block.headers, `${key}-head`).map((header) => (
                    <th
                      key={header.id}
                      className="border-b border-border-subtle px-2 py-1.5 font-semibold break-words"
                    >
                      {renderInline(header.text)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keyedRows(block.rows, `${key}-row`).map((row) => {
                  const cells = block.headers.map((_, columnIndex) => row.cells[columnIndex] ?? '');
                  return (
                    <tr key={row.id} className="odd:bg-surface-muted/60">
                      {keyedTexts(cells, `${row.id}-cell`).map((cell) => (
                        <td
                          key={cell.id}
                          className="border-b border-border-subtle px-2 py-1.5 align-top break-words last:border-b-0"
                        >
                          {renderInline(cell.text)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
