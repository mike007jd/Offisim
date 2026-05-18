import { Button } from '@offisim/ui-core';
import { useEffect, useState } from 'react';
import {
  DEFAULT_BADGE_COLOR,
  DEFAULT_PLACEHOLDER,
  NODE_BADGE_COLORS,
  NODE_DISPLAY_NAMES,
  NODE_PLACEHOLDERS,
} from '../../lib/agent-display';
import { MarkdownContent } from './MarkdownContent';

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
    <div className="flex w-full min-w-0 max-w-full flex-col items-start overflow-hidden">
      {label && (
        <span
          className={`inline-block mb-0.5 px-1.5 py-px rounded text-caption font-medium leading-tight ${badgeColor}`}
        >
          {label}
        </span>
      )}
      {reasoning && <ReasoningRegion reasoning={reasoning} hasContent={!!content} />}
      {(content || showPlaceholder) && (
        <div className="max-h-stream-content w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden overscroll-contain border-l-2 border-info px-2 py-1 text-sm leading-relaxed text-text-primary">
          {content ? (
            <>
              <MarkdownContent content={content} className="min-w-0 max-w-full" />
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
    <div className="mb-1 max-h-reasoning-content w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden overscroll-contain border-l-2 border-info/55 px-2 py-1 text-xs leading-snug text-text-primary">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpandedByUser(!expanded)}
        className="mb-0.5 h-auto gap-1 px-0 py-0 text-caption font-medium uppercase tracking-[0.12em] text-info hover:text-text-primary"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Reasoning</span>
      </Button>
      {expanded && (
        <MarkdownContent
          content={reasoning}
          className="min-w-0 max-w-full break-words text-xs leading-relaxed"
        />
      )}
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
        <span className="text-caption tabular-nums text-text-muted">{elapsedSec}s</span>
      )}
      <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-info" />
    </span>
  );
}
