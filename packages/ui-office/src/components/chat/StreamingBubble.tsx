import {
  DEFAULT_BADGE_COLOR,
  NODE_BADGE_COLORS,
  NODE_DISPLAY_NAMES,
} from '../../lib/agent-display';
import { useStreamingContent } from '../../runtime/use-streaming-content';
import { RichAssistantBody } from './message-rich-content';

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

export function StreamingBubble() {
  const { content, isStreaming, nodeName } = useStreamingContent();

  if (!isStreaming && !content) return null;

  const label = nodeName ? (NODE_DISPLAY_NAMES[nodeName] ?? nodeName) : null;
  const badgeColor = nodeName
    ? (NODE_BADGE_COLORS[nodeName] ?? DEFAULT_BADGE_COLOR)
    : DEFAULT_BADGE_COLOR;
  const placeholder = nodeName
    ? (NODE_PLACEHOLDERS[nodeName] ?? DEFAULT_PLACEHOLDER)
    : DEFAULT_PLACEHOLDER;
  const displayContent = content || (isStreaming ? placeholder : '\u00A0');
  const isStructured = /(^|\n)```|(^|\n)>\s*(Note|Warning|Result):|(^|\n)[-*]\s+/m.test(displayContent);

  return (
    <div className="flex flex-col items-start">
      {label && (
        <span
          className={`inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight ${badgeColor}`}
        >
          {label}
        </span>
      )}
      <div className="max-w-[80%] rounded-xl bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.14)]">
        {isStructured ? (
          <div className="space-y-3 whitespace-normal">
            <RichAssistantBody text={displayContent} expanded />
            {isStreaming && (
              <span className="inline-block h-3.5 w-1.5 rounded-sm bg-blue-400/60 align-middle animate-pulse" />
            )}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">
            {displayContent}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 rounded-sm bg-blue-400/60 animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
