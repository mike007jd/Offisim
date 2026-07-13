import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';

export function HtmlViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'inline-html' | 'url' | 'screenshot' }>;
}) {
  if (data.mode === 'inline-html') {
    // Scripts run only for AI-generated deliverables (interactive HTML reports).
    // Workspace and computer-use artifacts can be arbitrary saved web pages;
    // their scripts would inherit the app CSP's broad https: egress.
    const allowScripts = resolved.trustLevel === 'generated';
    return (
      <iframe
        className="off-stage-preview-frame"
        title={resolved.meta.title}
        sandbox={allowScripts ? 'allow-forms allow-scripts' : 'allow-forms'}
        srcDoc={data.html}
      />
    );
  }
  if (data.mode === 'url') {
    return (
      <iframe
        className="off-stage-preview-frame"
        title={resolved.meta.title}
        sandbox="allow-forms allow-scripts"
        src={data.url}
      />
    );
  }
  return (
    <div className="off-stage-preview-shot-wrap">
      <img className="off-stage-preview-shot" src={data.dataRef} alt={resolved.meta.title} />
      {resolved.meta.url ? (
        <code className="off-stage-preview-url">{resolved.meta.url}</code>
      ) : null}
    </div>
  );
}
