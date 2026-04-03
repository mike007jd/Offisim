import { cn } from '@offisim/ui-core';
import type { ReactNode } from 'react';
import { getBadgeColorForDisplayName } from '../../lib/agent-display';

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

// ── Citation rendering ─────────────────────────────────────────────

/** Render [N] citation markers as styled superscript badges. */
function renderWithCitations(text: string): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  let citationIndex = 0;
  return parts.map((part) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      citationIndex += 1;
      return (
        <sup
          key={`${match[1]}-${citationIndex}`}
          className="inline-flex items-center justify-center mx-0.5 px-1 min-w-[1.1em] h-4 text-[10px] font-bold rounded bg-blue-500/30 text-blue-200 cursor-default"
          title={`Citation ${match[1]}`}
        >
          {match[1]}
        </sup>
      );
    }
    return part;
  });
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
          'max-w-[80%] px-3 py-1.5 text-sm leading-snug whitespace-pre-wrap rounded-xl',
          isUser ? 'bg-blue-600/20 text-slate-100' : 'bg-white/5 text-slate-200',
        )}
      >
        {isUser ? displayContent : renderWithCitations(displayContent)}
      </div>
    </div>
  );
}
