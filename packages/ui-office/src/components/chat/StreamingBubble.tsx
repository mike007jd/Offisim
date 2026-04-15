import {
  DEFAULT_BADGE_COLOR,
  NODE_BADGE_COLORS,
  NODE_DISPLAY_NAMES,
} from '../../lib/agent-display';

const NODE_PLACEHOLDERS: Record<string, string> = {
  boss: 'Drafting the response...',
  boss_summary: 'Summarizing the outcome...',
  employee: 'Working through the request...',
  manager: 'Coordinating the next step...',
  pm_planner: 'Planning the next move...',
  pm_replan: 'Reworking the plan...',
  pm_heartbeat: 'Checking execution progress...',
  hr: 'Reviewing the situation...',
  error_handler: 'Recovering from an issue...',
  step_dispatcher: 'Dispatching the next step...',
};

const DEFAULT_PLACEHOLDER = 'Thinking...';

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
  if (!isStreaming && !content && !reasoning) return null;

  const label = nodeName ? (NODE_DISPLAY_NAMES[nodeName] ?? nodeName) : null;
  const badgeColor = nodeName
    ? (NODE_BADGE_COLORS[nodeName] ?? DEFAULT_BADGE_COLOR)
    : DEFAULT_BADGE_COLOR;
  const placeholder = nodeName
    ? (NODE_PLACEHOLDERS[nodeName] ?? DEFAULT_PLACEHOLDER)
    : DEFAULT_PLACEHOLDER;
  const showPlaceholder = !content && !reasoning && isStreaming;
  const displayContent = content || (showPlaceholder ? placeholder : '');

  return (
    <div className="flex flex-col items-start">
      {label && (
        <span
          className={`inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight ${badgeColor}`}
        >
          {label}
        </span>
      )}
      {reasoning && (
        <div className="mb-1 max-w-[94%] rounded-xl border border-indigo-400/20 bg-indigo-500/8 px-3 py-1.5 text-xs leading-snug text-indigo-100 whitespace-pre-wrap">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-indigo-200/80">
            Reasoning
          </div>
          {reasoning}
        </div>
      )}
      {(displayContent || (!content && !reasoning && isStreaming)) && (
        <div className="max-w-[94%] border-l-2 border-blue-400/30 bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap rounded-xl">
          {displayContent}
          {isStreaming && content && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400/60 animate-pulse rounded-sm" />
          )}
        </div>
      )}
      {isStreaming && !content && reasoning && (
        <div className="max-w-[94%] rounded-xl border border-blue-400/20 bg-white/5 px-3 py-1.5 text-sm text-slate-400">
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400/60 animate-pulse rounded-sm" />
        </div>
      )}
    </div>
  );
}
