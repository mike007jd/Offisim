import { Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  PIPELINE_STEPS,
  type PipelineStage,
  type PipelineStep,
  STAGE_META,
} from '../../hooks/usePipelineStage';
import { CEREMONY_LABELS } from '../../lib/ceremony-labels';
import { useSceneCeremony } from '../../runtime/scene-ceremony-context';

// ---------------------------------------------------------------------------
// PipelineProgress — visual progress bar for the multi-agent pipeline.
//
// Renders:  [Boss] ──→ [Manager] ──→ [PM] ──→ [Employee] ──→ [Summary]
//             ✓            ✓           ●
//
// States:
//   completed  — checkmark, green
//   active     — pulsing dot, stage color
//   pending    — hollow circle, gray
//   error      — red X (future use)
//
// Only shown when a pipeline is running. Height ~48px.
// ---------------------------------------------------------------------------

type NodeState = 'completed' | 'active' | 'pending' | 'error';

interface PipelineProgressProps {
  /** Current pipeline stage from usePipelineStage() — null hides the bar. */
  stage: PipelineStage;
  /** Whether the runtime is currently running (used for stop button). */
  isRunning: boolean;
  /** Callback to abort execution. */
  onAbort?: () => void;
}

function getNodeState(step: PipelineStep, activeStage: NonNullable<PipelineStage>): NodeState {
  const activeIdx = PIPELINE_STEPS.indexOf(activeStage);
  const stepIdx = PIPELINE_STEPS.indexOf(step);
  if (stepIdx < activeIdx) return 'completed';
  if (stepIdx === activeIdx) return 'active';
  return 'pending';
}

/** Inline SVG check icon — avoids importing a full icon for a 10px glyph. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      className="w-2.5 h-2.5"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StageNode({ step, state }: { step: PipelineStep; state: NodeState }) {
  const meta = STAGE_META[step];

  return (
    <div className="flex flex-col items-center gap-1 relative z-10">
      {/* Circle indicator */}
      <div
        className={[
          'w-5 h-5 rounded-full flex items-center justify-center transition-all duration-500 ease-out',
          state === 'completed'
            ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
            : state === 'active'
              ? 'ring-2 ring-current shadow-[0_0_8px_rgba(59,130,246,0.3)]'
              : state === 'error'
                ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40'
                : 'bg-white/5 text-slate-500 ring-1 ring-white/10',
          state === 'active' ? meta.chatColorClass : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {state === 'completed' && <CheckIcon />}
        {state === 'active' && (
          <span className={['w-2 h-2 rounded-full animate-pulse', meta.dotClass].join(' ')} />
        )}
        {state === 'error' && <span className="text-[10px] font-bold leading-none">✗</span>}
        {state === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-white/10" />}
      </div>

      {/* Label */}
      <span
        className={[
          'text-[10px] font-medium tracking-wide leading-none transition-colors duration-500',
          state === 'completed'
            ? 'text-emerald-400/70'
            : state === 'active'
              ? meta.chatColorClass
              : state === 'error'
                ? 'text-red-400/70'
                : 'text-slate-500',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {meta.shortLabel}
      </span>
    </div>
  );
}

/** Connecting line between nodes. */
function Connector({ state }: { state: 'done' | 'pending' }) {
  return (
    <div className="flex-1 flex items-center -mt-3">
      <div
        className={[
          'h-px w-full transition-colors duration-500',
          state === 'done' ? 'bg-emerald-500/30' : 'bg-white/8',
        ].join(' ')}
      />
    </div>
  );
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

  const activeCeremonyLabel =
    ceremony &&
    (ceremony.phase === 'dispatching' ||
      ceremony.phase === 'working' ||
      ceremony.phase === 'reporting')
      ? (CEREMONY_LABELS[ceremony.phase]?.label ?? null)
      : null;

  const activeIdx = PIPELINE_STEPS.indexOf(stage);

  return (
    <div
      ref={containerRef}
      className="border-t border-white/5 bg-black/20 backdrop-blur-sm"
      style={{
        opacity: 0,
        transform: 'translateY(4px)',
        transition: 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
    >
      <div className="px-4 pt-2.5 pb-2">
        <div className="flex items-start gap-0">
          {PIPELINE_STEPS.map((step, i) => {
            const nodeState = getNodeState(step, stage);
            const connectorDone = i < activeIdx;
            return (
              <div key={step} className="contents">
                <StageNode step={step} state={nodeState} />
                {i < PIPELINE_STEPS.length - 1 && (
                  <Connector state={connectorDone ? 'done' : 'pending'} />
                )}
              </div>
            );
          })}

          {/* Stop button — pinned to the right */}
          {isRunning && onAbort && (
            <div className="ml-2 flex items-center -mt-0.5">
              <button
                type="button"
                onClick={onAbort}
                title="Stop execution"
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>
        {activeCeremonyLabel && (
          <div className="mt-1 text-[10px] text-slate-500 tracking-wide text-center">
            {activeCeremonyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
