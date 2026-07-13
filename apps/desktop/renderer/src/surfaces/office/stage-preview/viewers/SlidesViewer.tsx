import { type ParsedAttachment, parseAttachment } from '@offisim/doc-engine';
import { useEffect, useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { TextViewer } from './TextViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

type ParseState =
  | { status: 'loading' }
  | { status: 'ready'; parsed: ParsedAttachment }
  | { status: 'error'; message: string };

function slidesWithStableKeys(slides: readonly string[]) {
  const occurrences = new Map<string, number>();
  return slides.map((text) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    return { key: JSON.stringify([text, occurrence]), text };
  });
}

export function SlidesViewer({
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
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

  if (state.status === 'loading') {
    return (
      <div className="off-stage-empty">
        <strong>Loading slides</strong>
        <span>Parsing deck text for preview.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: state.message }} />;
  }
  if (state.parsed.kind !== 'pptx') {
    return (
      <UnsupportedViewer
        resolved={resolved}
        data={{ mode: 'none', reason: 'Slide parser did not return PPTX content.' }}
      />
    );
  }
  return (
    <div className="off-slides-viewer">
      <div className="off-preview-text-tools">
        <span>{state.parsed.slides.length.toLocaleString()} slides</span>
        <button type="button" onClick={() => setRaw(!raw)}>
          {raw ? 'Slides' : 'Raw'}
        </button>
      </div>
      {raw ? (
        <TextViewer text={state.parsed.text} />
      ) : (
        <div className="off-slides-scroll">
          {slidesWithStableKeys(state.parsed.slides).map((slide, index) => (
            <article key={slide.key} className="off-slide-card">
              <span>Slide {index + 1}</span>
              <p>{slide.text}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
