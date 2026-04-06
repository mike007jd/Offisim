import { Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { type PipelineStage, STAGE_META } from '../../hooks/usePipelineStage';
import { CEREMONY_LABELS } from '../../lib/ceremony-labels';
import { useSceneCeremony } from '../../runtime/scene-ceremony-context';

interface PipelineProgressProps {
  /** Current pipeline stage from usePipelineStage() — null hides the bar. */
  stage: PipelineStage;
  /** Whether the runtime is currently running (used for stop button). */
  isRunning: boolean;
  /** Callback to abort execution. */
  onAbort?: () => void;
}

export function PipelineProgress({ stage, isRunning, onAbort }: PipelineProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ceremony = useSceneCeremony();

  // Animate entrance with a slight delay
  useEffect(() => {
    if (stage && containerRef.current) {
      containerRef.current.style.opacity = '1';
      containerRef.current.style.transform = 'translateY(0)';
    }
  }, [stage]);

  if (!stage) return null;

  const meta = STAGE_META[stage];

  const activeCeremonyLabel =
    ceremony &&
    (ceremony.phase === 'dispatching' ||
      ceremony.phase === 'working' ||
      ceremony.phase === 'reporting')
      ? (CEREMONY_LABELS[ceremony.phase]?.label ?? null)
      : null;

  const statusLabel = activeCeremonyLabel ?? meta.chatLabel;

  return (
    <div
      ref={containerRef}
      className="border-b border-white/5 bg-white/[0.02] backdrop-blur-sm"
      style={{
        opacity: 0,
        transform: 'translateY(4px)',
        transition: 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={[
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]',
              'border-white/10 bg-black/20',
              meta.chatColorClass,
            ].join(' ')}
          >
            {meta.shortLabel}
          </span>
          <span className="min-w-0 truncate text-xs text-slate-300">{statusLabel}</span>
        </div>

        {activeCeremonyLabel && (
          <span className="hidden shrink-0 text-[10px] text-slate-500 md:inline">{meta.label}</span>
        )}

        <div className="shrink-0">
          {isRunning && onAbort && (
            <button
              type="button"
              onClick={onAbort}
              title="Stop execution"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-500 transition-colors hover:bg-red-400/10 hover:text-red-400"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
