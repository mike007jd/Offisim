import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Render an assistant deliverable as Markdown — headings, lists, tables, and
 * fenced code blocks — instead of a wall of raw text. A coding harness emits
 * Markdown constantly; rendering it is what makes the reply read as a coherent
 * deliverable rather than a dump. Styling is CSS-only (`.off-office-md` in
 * office.css) against the --off-* token system, so no inline styles leak in.
 *
 * Streaming-safe: callers feed the live `part.text` string, so the tree
 * re-renders chunk-by-chunk as tokens arrive.
 */
const MARKDOWN_COMPONENTS: Components = {
  // A model-authored link must never navigate the webview away from the app.
  // Show the destination on hover and render it as styled, non-navigating text;
  // opening links in the OS browser is a deliberate follow-up, not a default.
  a: ({ href, children }) => (
    <span className="off-office-md-link" title={typeof href === 'string' ? href : undefined}>
      {children}
    </span>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="off-office-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
