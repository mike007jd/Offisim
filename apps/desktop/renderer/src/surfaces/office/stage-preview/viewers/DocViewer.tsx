import { parseAttachment, type ParsedAttachment } from '@offisim/doc-engine';
import { useEffect, useMemo, useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { TextViewer } from './TextViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

type ParseState =
  | { status: 'loading' }
  | { status: 'ready'; parsed: ParsedAttachment }
  | { status: 'error'; message: string };

function sanitizeDocHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((node) => node.remove());
  doc.querySelectorAll<HTMLElement>('*').forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        node.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
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
      resolved.meta.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      resolved.meta.title,
    )
      .then((parsed) => {
        if (!cancelled) setState({ status: 'ready', parsed });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [data.bytes, resolved.meta.mimeType, resolved.meta.title]);

  const safeHtml = useMemo(() => {
    if (state.status !== 'ready' || state.parsed.kind !== 'docx') return '';
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
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: 'Document parser did not return DOCX content.' }} />;
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
          <div className="off-doc-html" dangerouslySetInnerHTML={{ __html: safeHtml }} />
        </div>
      )}
    </div>
  );
}
