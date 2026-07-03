import { useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'duration pending';
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function MediaViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'stream' }>;
}) {
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  if (failed) {
    return (
      <UnsupportedViewer
        resolved={resolved}
        data={{
          mode: 'none',
          reason:
            'This media stream could not be decoded by the desktop WebView. Supported codecs include H.264, HEVC, AAC, and MP3.',
        }}
      />
    );
  }

  return (
    <div className="off-media-viewer">
      <div className="off-preview-text-tools">
        <span>{duration == null ? 'metadata pending' : formatDuration(duration)}</span>
      </div>
      <div className="off-media-stage">
        {resolved.viewerKind === 'audio' ? (
          <audio
            controls
            src={data.streamUrl}
            onError={() => setFailed(true)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          />
        ) : (
          <video
            controls
            src={data.streamUrl}
            onError={() => setFailed(true)}
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          />
        )}
      </div>
    </div>
  );
}
