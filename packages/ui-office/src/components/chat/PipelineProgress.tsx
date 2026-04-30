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
  /** Human-readable boss routing label from boss.route.decided. */
  routeLabel?: string | null;
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
            ? 'bg-success-muted text-success ring-1 ring-success'
            : state === 'active'
              ? 'ring-2 ring-current shadow-glow-accent'
              : state === 'error'
                ? 'bg-error-muted text-error ring-1 ring-error'
                : 'bg-surface-muted text-text-muted ring-1 ring-border-default',
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
        {state === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-border-default" />}
      </div>

      {/* Label */}
      <span
        className={[
          'text-[10px] font-medium tracking-wide leading-none transition-colors duration-500',
          state === 'completed'
            ? 'text-success'
            : state === 'active'
              ? meta.chatColorClass
              : state === 'error'
                ? 'text-error'
                : 'text-text-muted',
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
          state === 'done' ? 'bg-success' : 'bg-border-subtle',
        ].join(' ')}
      />
    </div>
  );
}

export function PipelineProgress({ stage, routeLabel, isRunning, onAbort }: PipelineProgressProps) {
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
      className="border-t border-border-subtle bg-surface-elevated backdrop-blur-sm"
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
                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-error-muted hover:text-error"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>
        {(routeLabel || activeCeremonyLabel) && (
          <div className="mt-1 text-center text-[10px] tracking-wide text-text-muted">
            {activeCeremonyLabel ?? routeLabel}
          </div>
        )}
      </div>
    </div>
  );
}
