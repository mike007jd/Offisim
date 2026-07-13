import { type ParsedAttachment, parseAttachment } from '@offisim/doc-engine';
import { type ReactNode, createElement, useEffect, useMemo, useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { TextViewer } from './TextViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

type ParseState =
  | { status: 'loading' }
  | { status: 'ready'; parsed: ParsedAttachment }
  | { status: 'error'; message: string };

const SAFE_DOC_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const DROPPED_DOC_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);

function safeDocUrl(value: string, image: boolean): string | undefined {
  const normalized = value.trim();
  if (/^(?:https?:|mailto:|tel:|#)/i.test(normalized)) return normalized;
  if (image && /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(normalized)) {
    return normalized;
  }
  return undefined;
}

function renderDocNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;

  const tagName = node.tagName.toLowerCase();
  if (DROPPED_DOC_TAGS.has(tagName)) return null;

  const children = Array.from(node.childNodes, (child, index) =>
    renderDocNode(child, `${key}.${index}`),
  );
  if (!SAFE_DOC_TAGS.has(tagName)) return children;

  const props: Record<string, unknown> = { key };
  const className = node.getAttribute('class');
  const id = node.getAttribute('id');
  const title = node.getAttribute('title');
  if (className) props.className = className;
  if (id) props.id = id;
  if (title) props.title = title;

  if (tagName === 'a') {
    const href = node.getAttribute('href');
    if (href) props.href = safeDocUrl(href, false);
  } else if (tagName === 'img') {
    const src = node.getAttribute('src');
    const alt = node.getAttribute('alt');
    if (!src || !safeDocUrl(src, true)) return alt;
    props.src = safeDocUrl(src, true);
    if (alt) props.alt = alt;
  } else if (tagName === 'td' || tagName === 'th') {
    const colSpan = Number.parseInt(node.getAttribute('colspan') ?? '', 10);
    const rowSpan = Number.parseInt(node.getAttribute('rowspan') ?? '', 10);
    if (colSpan > 0) props.colSpan = colSpan;
    if (rowSpan > 0) props.rowSpan = rowSpan;
  }

  return createElement(tagName, props, children);
}

function sanitizeDocHtml(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.body.childNodes, (node, index) => renderDocNode(node, String(index)));
}

export function DocViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'bytes' }>;
}) {
  const [state, setState] = useState<ParseState>({ status: 'loading' });
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void parseAttachment(
      new Uint8Array(data.bytes),
      resolved.meta.mimeType ??
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      resolved.meta.title,
    )
      .then((parsed) => {
        if (!cancelled) setState({ status: 'ready', parsed });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.bytes, resolved.meta.mimeType, resolved.meta.title]);

  const safeContent = useMemo(() => {
    if (state.status !== 'ready' || state.parsed.kind !== 'docx') return null;
    return sanitizeDocHtml(state.parsed.html);
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="off-stage-empty">
        <strong>Loading document</strong>
        <span>Parsing DOCX content for preview.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: state.message }} />;
  }
  if (state.parsed.kind !== 'docx') {
    return (
      <UnsupportedViewer
        resolved={resolved}
        data={{ mode: 'none', reason: 'Document parser did not return DOCX content.' }}
      />
    );
  }
  return (
    <div className="off-doc-viewer">
      <div className="off-preview-text-tools">
        <button type="button" onClick={() => setRaw(!raw)}>
          {raw ? 'Rendered' : 'Raw'}
        </button>
      </div>
      {raw ? (
        <TextViewer text={state.parsed.text} />
      ) : (
        <div className="off-doc-scroll">
          <div className="off-doc-html">{safeContent}</div>
        </div>
      )}
    </div>
  );
}
