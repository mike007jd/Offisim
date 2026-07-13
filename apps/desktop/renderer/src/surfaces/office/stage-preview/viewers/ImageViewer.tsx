import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Expand, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // React delegates wheel listeners passively, so zoom needs a direct
    // non-passive listener to stop the surrounding pane from scrolling.
    const onWheel = (event: WheelEvent) => {
      if (fitRef.current) return;
      event.preventDefault();
      setZoom((value) => Math.max(0.25, Math.min(4, value + (event.deltaY > 0 ? -0.1 : 0.1))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="off-image-viewer">
      <div className="off-image-tools">
        {dimensions ? (
          <span>
            {dimensions.width} × {dimensions.height}
          </span>
        ) : null}
        <button type="button" onClick={() => setFit(!fit)}>
          <Icon icon={Expand} size="sm" />
          {fit ? 'Actual' : 'Fit'}
        </button>
        <button
          type="button"
          disabled={fit}
          onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
        >
          <Icon icon={ZoomOut} size="sm" />
        </button>
        <button
          type="button"
          disabled={fit}
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          <Icon icon={ZoomIn} size="sm" />
        </button>
        {fit ? null : <span>{Math.round(zoom * 100)}%</span>}
      </div>
      <div
        ref={canvasRef}
        className={cn('off-image-canvas', !fit && 'is-pannable')}
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
          onLoad={(event) =>
            setDimensions({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
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
