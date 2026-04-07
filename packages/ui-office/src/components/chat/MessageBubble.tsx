import { cn } from '@offisim/ui-core';
import { useState } from 'react';
import { getBadgeColorForDisplayName } from '../../lib/agent-display';
import { RichAssistantBody, useAssistantBlocks } from './message-rich-content';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── Agent identity extraction ──────────────────────────────────────

interface ParsedAgent {
  name: string;
  body: string;
}

function parseAgentIdentity(content: string): ParsedAgent | null {
  // Match `[Name]: rest`, `[Name]:rest`, or `[Name] rest` at the start of content.
  // The colon is optional to support error-handler style `[Error Handler] message`.
  // Requires the name to contain at least one non-digit character to avoid
  // colliding with citation markers like [1], [2], etc.
  const match = /^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/.exec(content);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  return { name, body: content.slice(match[0].length) };
}

function badgeColorFor(agentName: string): string {
  return getBadgeColorForDisplayName(agentName);
}

// ── Component ──────────────────────────────────────────────────────

export function MessageBubble({ role, content }: MessageBubbleProps) {
  // System messages: full-width, monospace, no avatar
  if (role === 'system') {
    return (
      <div data-role="system" className="px-1 py-1">
        <div className="font-mono text-[11px] text-slate-500 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      </div>
    );
  }

  const isUser = role === 'user';
  const agent = !isUser ? parseAgentIdentity(content) : null;
  const displayContent = agent ? agent.body : content;
  const assistantBlocks = useAssistantBlocks(displayContent);
  const shouldCollapse = !isUser && assistantBlocks.length > 6;
  const [expanded, setExpanded] = useState(false);

  return (
    <div data-role={role} className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      {/* Agent identity badge */}
      {agent && (
        <span
          className={cn(
            'inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight',
            badgeColorFor(agent.name),
          )}
        >
          {agent.name}
        </span>
      )}
      <div
        className={cn(
          'max-w-[80%] px-3 py-1.5 text-sm leading-snug rounded-xl',
          isUser ? 'bg-blue-600/20 text-slate-100' : 'bg-white/5 text-slate-200',
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{displayContent}</div>
        ) : (
          <div className="space-y-3 whitespace-normal">
            <RichAssistantBody text={displayContent} expanded={expanded} />
            {shouldCollapse ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-label={expanded ? 'Collapse response' : 'Show full response'}
                className="text-xs font-medium text-cyan-200 transition-colors hover:text-cyan-100"
              >
                {expanded
                  ? 'Collapse response'
                  : `Show full response (${assistantBlocks.length} sections)`}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
