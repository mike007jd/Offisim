import { useStreamingContent } from '../../runtime/use-streaming-content';

/** Map graph node names to human-readable agent labels for the streaming badge. */
const NODE_LABELS: Record<string, string> = {
  boss: 'Boss',
  boss_summary: 'Boss',
  employee: 'Employee',
  manager: 'Manager',
  pm_planner: 'PM',
  pm_replan: 'PM',
  pm_heartbeat: 'PM',
  hr: 'HR',
  error_handler: 'Error Handler',
  step_dispatcher: 'Dispatcher',
};

/** Badge color classes matching MessageBubble's AGENT_BADGE_COLORS. */
const NODE_BADGE_COLORS: Record<string, string> = {
  boss: 'bg-amber-500/25 text-amber-300',
  boss_summary: 'bg-amber-500/25 text-amber-300',
  manager: 'bg-emerald-500/25 text-emerald-300',
  pm_planner: 'bg-purple-500/25 text-purple-300',
  pm_replan: 'bg-purple-500/25 text-purple-300',
  pm_heartbeat: 'bg-purple-500/25 text-purple-300',
  hr: 'bg-rose-500/25 text-rose-300',
  employee: 'bg-blue-500/25 text-blue-300',
  error_handler: 'bg-red-500/25 text-red-300',
};

const DEFAULT_BADGE = 'bg-slate-500/25 text-slate-300';

export function StreamingBubble() {
  const { content, isStreaming, nodeName } = useStreamingContent();

  if (!isStreaming && !content) return null;

  const label = nodeName ? (NODE_LABELS[nodeName] ?? nodeName) : null;
  const badgeColor = nodeName ? (NODE_BADGE_COLORS[nodeName] ?? DEFAULT_BADGE) : DEFAULT_BADGE;

  return (
    <div className="flex flex-col items-start">
      {/* Streaming source badge */}
      {label && (
        <span
          className={`inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight ${badgeColor}`}
        >
          {label}
        </span>
      )}
      <div className="max-w-[80%] bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap rounded-xl">
        {content || '\u00A0'}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-blue-400/60 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
