import { Markdown } from '@/design-system/grammar/Markdown.js';
import { useState } from 'react';
import { TextViewer } from './TextViewer.js';

export function MarkdownViewer({ text, truncated }: { text: string; truncated?: boolean }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="off-markdown-preview">
      <div className="off-preview-text-tools">
        <span>Markdown</span>
        <button type="button" onClick={() => setRaw(!raw)}>
          {raw ? 'Rendered' : 'Raw'}
        </button>
      </div>
      {raw ? (
        <TextViewer text={text} truncated={truncated} languageLabel="Markdown" />
      ) : (
        <div className="off-markdown-scroll">
          {truncated ? (
            <div className="off-preview-banner">Preview truncated at the desktop text budget.</div>
          ) : null}
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
