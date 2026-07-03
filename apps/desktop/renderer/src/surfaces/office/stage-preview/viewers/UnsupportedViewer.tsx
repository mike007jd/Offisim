import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';

export function UnsupportedViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: PreviewData;
}) {
  const reason =
    data.mode === 'none'
      ? data.reason
      : `${resolved.viewerKind.toUpperCase()} support is not available in this viewer yet.`;
  return (
    <div className="off-preview-unsupported">
      <strong>Preview unavailable</strong>
      <span>{reason}</span>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{resolved.viewerKind}</dd>
        </div>
        {resolved.meta.path ? (
          <div>
            <dt>Path</dt>
            <dd>{resolved.meta.path}</dd>
          </div>
        ) : null}
        {resolved.meta.url ? (
          <div>
            <dt>URL</dt>
            <dd>{resolved.meta.url}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
