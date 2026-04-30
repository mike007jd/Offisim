import { useEffect, useState } from 'react';
import {
  DEFAULT_BADGE_COLOR,
  DEFAULT_PLACEHOLDER,
  NODE_BADGE_COLORS,
  NODE_DISPLAY_NAMES,
  NODE_PLACEHOLDERS,
} from '../../lib/agent-display';

interface StreamingBubbleProps {
  content: string;
  reasoning: string;
  isStreaming: boolean;
  nodeName: string | null;
}

export function StreamingBubble({
  content,
  reasoning,
  isStreaming,
  nodeName,
}: StreamingBubbleProps) {
  if (!nodeName && !content && !reasoning) return null;

  const label = nodeName ? (NODE_DISPLAY_NAMES[nodeName] ?? nodeName) : null;
  const badgeColor = nodeName
    ? (NODE_BADGE_COLORS[nodeName] ?? DEFAULT_BADGE_COLOR)
    : DEFAULT_BADGE_COLOR;
  const placeholder = nodeName
    ? (NODE_PLACEHOLDERS[nodeName] ?? DEFAULT_PLACEHOLDER)
    : DEFAULT_PLACEHOLDER;
  const showPlaceholder = !content && !reasoning && !!nodeName;

  return (
    <div className="flex flex-col items-start">
      {label && (
        <span
          className={`inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight ${badgeColor}`}
        >
          {label}
        </span>
      )}
      {reasoning && <ReasoningRegion reasoning={reasoning} hasContent={!!content} />}
      {(content || showPlaceholder) && (
        <div className="max-h-[60vh] max-w-[94%] overflow-y-auto overscroll-contain rounded-xl border-l-2 border-info bg-surface-muted px-3 py-1.5 text-sm leading-snug text-text-primary whitespace-pre-wrap">
          {content ? (
            <>
              {content}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-info" />
              )}
            </>
          ) : (
            <PlaceholderWithTimer key={nodeName ?? 'placeholder'} text={placeholder} />
          )}
        </div>
      )}
    </div>
  );
}

interface ReasoningRegionProps {
  reasoning: string;
  hasContent: boolean;
}

function ReasoningRegion({ reasoning, hasContent }: ReasoningRegionProps) {
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const expanded = expandedByUser ?? !hasContent;

  return (
    <div className="mb-1 max-h-[40vh] max-w-[94%] overflow-y-auto overscroll-contain rounded-xl border border-info bg-info-muted px-3 py-1.5 text-xs leading-snug text-text-primary">
      <button
        type="button"
        onClick={() => setExpandedByUser(!expanded)}
        className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-info transition-colors hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Reasoning</span>
      </button>
      {expanded && <div className="whitespace-pre-wrap">{reasoning}</div>}
    </div>
  );
}

interface PlaceholderWithTimerProps {
  text: string;
}

function PlaceholderWithTimer({ text }: PlaceholderWithTimerProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5 text-text-secondary">
      <span className="relative inline-block overflow-hidden rounded-sm px-0.5 text-text-secondary">
        <span>{text}</span>
        <span className="pointer-events-none absolute inset-0 streaming-shimmer" aria-hidden />
      </span>
      {elapsedSec > 0 && (
        <span className="text-[11px] tabular-nums text-text-muted">{elapsedSec}s</span>
      )}
      <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-info" />
    </span>
  );
}
