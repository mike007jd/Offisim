import { cn } from '@aics/ui-core';
import type { ReactNode } from 'react';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

// ── Agent identity extraction ──────────────────────────────────────
// Messages from the graph arrive in `[AgentName]: content` format.
// We parse this prefix to show a badge above the message bubble.

interface ParsedAgent {
  name: string;
  body: string;
}

/** Known system agent names → badge color class */
const AGENT_BADGE_COLORS: Record<string, string> = {
  Boss: 'bg-amber-500/25 text-amber-300',
  PM: 'bg-purple-500/25 text-purple-300',
  Manager: 'bg-emerald-500/25 text-emerald-300',
  HR: 'bg-rose-500/25 text-rose-300',
  'Error Handler': 'bg-red-500/25 text-red-300',
  Meeting: 'bg-cyan-500/25 text-cyan-300',
};

/** Default badge color for employees (not in the system-agent map). */
const DEFAULT_BADGE_COLOR = 'bg-blue-500/25 text-blue-300';

function parseAgentIdentity(content: string): ParsedAgent | null {
  // Match `[Name]: rest`, `[Name]:rest`, or `[Name] rest` at the start of content.
  // The colon is optional to support error-handler style `[Error Handler] message`.
  // Requires the name to contain at least one non-digit character to avoid
  // colliding with citation markers like [1], [2], etc.
  const match = /^\[([^\]]*[a-zA-Z][^\]]*)\]:?\s?/.exec(content);
  if (!match) return null;
  return { name: match[1]!, body: content.slice(match[0].length) };
}

function badgeColorFor(agentName: string): string {
  return AGENT_BADGE_COLORS[agentName] ?? DEFAULT_BADGE_COLOR;
}

// ── Citation rendering ─────────────────────────────────────────────

/** Render [N] citation markers as styled superscript badges. */
function renderWithCitations(text: string): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      return (
        <sup
          key={i}
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
          isUser
            ? 'bg-blue-600/20 text-slate-100'
            : 'bg-white/5 text-slate-200',
        )}
      >
        {isUser ? displayContent : renderWithCitations(displayContent)}
      </div>
    </div>
  );
}
