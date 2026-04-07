import { Check, Copy } from 'lucide-react';
import { Fragment, type ReactNode, useMemo, useState } from 'react';

export type AssistantBlock =
  | { type: 'code'; key: string; language: string | null; code: string }
  | { type: 'list'; key: string; items: string[] }
  | { type: 'paragraph'; key: string; lines: string[] }
  | {
      type: 'callout';
      key: string;
      tone: 'note' | 'warning' | 'result';
      title: string;
      body: string;
    };

function renderWithCitations(text: string): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  let citationIndex = 0;
  return parts.map((part) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      citationIndex += 1;
      return (
        <sup
          key={`${match[1]}-${citationIndex}`}
          className="mx-0.5 inline-flex h-4 min-w-[1.1em] cursor-default items-center justify-center rounded bg-blue-500/30 px-1 text-[10px] font-bold text-blue-200"
          title={`Citation ${match[1]}`}
        >
          {match[1]}
        </sup>
      );
    }
    return part;
  });
}

export function renderInlineMarkdown(text: string): ReactNode {
  const strongSplit = text.split(/(\*\*[^*]+\*\*)/g);
  let key = 0;

  return strongSplit.map((segment) => {
    const strongMatch = /^\*\*([^*]+)\*\*$/.exec(segment);
    if (strongMatch) {
      key += 1;
      return <strong key={`strong-${key}`}>{renderWithCitations(strongMatch[1] ?? '')}</strong>;
    }

    const inlineCodeSplit = segment.split(/(`[^`]+`)/g);
    return inlineCodeSplit.map((inlineSegment) => {
      const codeMatch = /^`([^`]+)`$/.exec(inlineSegment);
      key += 1;
      if (codeMatch) {
        return (
          <code
            key={`code-${key}`}
            className="rounded bg-black/35 px-1 py-0.5 font-mono text-[0.9em] text-cyan-100"
          >
            {codeMatch[1]}
          </code>
        );
      }
      return <span key={`text-${key}`}>{renderWithCitations(inlineSegment)}</span>;
    });
  });
}

export function parseAssistantBlocks(text: string): AssistantBlock[] {
  const lines = text.split('\n');
  const blocks: AssistantBlock[] = [];
  let paragraphLines: string[] = [];
  let listLines: string[] = [];
  let codeFenceLanguage: string | null = null;
  let codeLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    blocks.push({
      type: 'paragraph',
      key: `paragraph-${blocks.length}-${paragraphLines.join('\n')}`,
      lines: paragraphLines,
    });
    paragraphLines = [];
  }

  function flushList() {
    if (listLines.length === 0) return;
    blocks.push({
      type: 'list',
      key: `list-${blocks.length}-${listLines.join('\n')}`,
      items: listLines,
    });
    listLines = [];
  }

  function flushCode() {
    blocks.push({
      type: 'code',
      key: `code-${blocks.length}-${codeLines.join('\n')}`,
      language: codeFenceLanguage,
      code: codeLines.join('\n'),
    });
    codeFenceLanguage = null;
    codeLines = [];
  }

  function pushCallout(rawLine: string) {
    const calloutMatch = /^>\s*(Note|Warning|Result):\s*(.+)$/i.exec(rawLine.trim());
    if (!calloutMatch) return false;
    flushParagraph();
    flushList();
    const label = calloutMatch[1] ?? 'Note';
    const tone = label.toLowerCase() as 'note' | 'warning' | 'result';
    const title = label[0]?.toUpperCase()
      ? label[0].toUpperCase() + label.slice(1).toLowerCase()
      : 'Note';
    blocks.push({
      type: 'callout',
      key: `callout-${blocks.length}-${rawLine}`,
      tone,
      title,
      body: calloutMatch[2] ?? '',
    });
    return true;
  }

  for (const line of lines) {
    const fenceMatch = /^```([a-zA-Z0-9_-]+)?\s*$/.exec(line.trim());
    if (fenceMatch) {
      flushParagraph();
      flushList();
      if (codeFenceLanguage !== null) {
        flushCode();
      } else {
        codeFenceLanguage = fenceMatch[1] ?? null;
      }
      continue;
    }

    if (codeFenceLanguage !== null) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (pushCallout(line)) {
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      flushParagraph();
      listLines.push(line.trim().slice(2));
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  if (codeFenceLanguage !== null) {
    flushCode();
  }

  return blocks;
}

function CodeBlock({ language, code }: { language: string | null; code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-black/35">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        <span>{language ?? 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copy code block"
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CalloutBlock({
  tone,
  title,
  body,
}: {
  tone: 'note' | 'warning' | 'result';
  title: string;
  body: string;
}) {
  const toneClass =
    tone === 'warning'
      ? 'border-amber-400/25 bg-amber-400/10 text-amber-50'
      : tone === 'result'
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-50'
        : 'border-cyan-400/20 bg-cyan-400/8 text-cyan-50';

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">
        {title}
      </div>
      <div className="mt-1 text-sm leading-relaxed">{renderInlineMarkdown(body)}</div>
    </div>
  );
}

export function RichAssistantBody({
  text,
  expanded,
}: {
  text: string;
  expanded: boolean;
}): ReactNode {
  const blocks = parseAssistantBlocks(text);
  const visibleBlocks = expanded ? blocks : blocks.slice(0, 6);

  return visibleBlocks.map((block) => {
    if (block.type === 'code') {
      return <CodeBlock key={block.key} language={block.language} code={block.code} />;
    }

    if (block.type === 'callout') {
      return (
        <CalloutBlock key={block.key} tone={block.tone} title={block.title} body={block.body} />
      );
    }

    if (block.type === 'list') {
      return (
        <ul key={block.key} className="list-disc space-y-1 pl-5">
          {block.items.map((item) => (
            <li key={`${block.key}-${item}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={block.key} className="leading-relaxed">
        {block.lines.map((line, lineIndex) => (
          <Fragment key={`${block.key}-${lineIndex}-${line}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInlineMarkdown(line)}
          </Fragment>
        ))}
      </p>
    );
  });
}

export function useAssistantBlocks(text: string): AssistantBlock[] {
  return useMemo(() => parseAssistantBlocks(text), [text]);
}
