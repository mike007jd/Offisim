import { Move, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';

export function ImageViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'bytes' }>;
}) {
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const sizeLabel = resolved.meta.byteLength
    ? `${resolved.meta.byteLength.toLocaleString()} B`
    : `${data.bytes.byteLength.toLocaleString()} B`;
  return (
    <div className="off-image-viewer">
      <div className="off-image-tools">
        <span>{resolved.meta.mimeType ?? resolved.meta.extension ?? 'image'}</span>
        <span>{sizeLabel}</span>
        <button type="button" onClick={() => setFit(!fit)}>
          <Move size={14} aria-hidden="true" />
          {fit ? 'Actual' : 'Fit'}
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}>
          <ZoomOut size={14} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>
          <ZoomIn size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        className="off-image-canvas"
        onWheel={(event) => {
          if (fit) return;
          event.preventDefault();
          setZoom((value) => Math.max(0.25, Math.min(4, value + (event.deltaY > 0 ? -0.1 : 0.1))));
        }}
        onPointerDown={(event) => {
          if (fit) return;
          const start = { x: event.clientX, y: event.clientY, origin };
          const move = (moveEvent: PointerEvent) => {
            setOrigin({
              x: start.origin.x + moveEvent.clientX - start.x,
              y: start.origin.y + moveEvent.clientY - start.y,
            });
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        <img
          src={data.objectUrl}
          alt={resolved.meta.title}
          style={
            fit
              ? undefined
              : { transform: `translate(${origin.x}px, ${origin.y}px) scale(${zoom})` }
          }
        />
      </div>
    </div>
  );
}
