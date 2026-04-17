import { cn } from '@offisim/ui-core';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Deliverable } from '../../hooks/useDeliverables';
import {
  DEFAULT_BADGE_COLOR,
  NODE_BADGE_COLORS,
  getBadgeColorForDisplayName,
  humanizeNodeName,
} from '../../lib/agent-display';
import { stripLegacySpeakerPrefix } from '../../lib/legacy-speaker-prefix';
import { DeliverableCard } from '../deliverable/DeliverableCard';
import type { MessageStatus } from './chat-session-store';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: MessageStatus;
  nodeName?: string | null;
  reasoning?: string;
  deliverables?: Deliverable[];
}

const FILENAME_LINE = /(^|\n)\s*Filename\s*:\s*[^\n]+\s*(?=\n|$)/gi;
const FENCED_CODE_BLOCK_RE = /```[a-zA-Z0-9#+._-]*\s*\n[\s\S]*?\n```/g;

function stripFencedArtifactContent(content: string): string {
  return content.replace(FENCED_CODE_BLOCK_RE, '').replace(FILENAME_LINE, '').trim();
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

export function MessageBubble({
  role,
  content,
  status,
  nodeName,
  reasoning,
  deliverables,
}: MessageBubbleProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const hasDeliverables = !!deliverables && deliverables.length > 0;

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

  // Speaker identity: prefer structured nodeName, fall back to legacy regex parsing
  let badgeLabel: string | null = null;
  let badgeColor: string = DEFAULT_BADGE_COLOR;
  let displayContent = content;

  if (!isUser && nodeName) {
    badgeLabel = humanizeNodeName(nodeName);
    badgeColor = NODE_BADGE_COLORS[nodeName] ?? DEFAULT_BADGE_COLOR;
    displayContent = stripLegacySpeakerPrefix(content);
  } else if (!isUser) {
    const agent = parseAgentIdentity(content);
    if (agent) {
      badgeLabel = agent.name;
      badgeColor = badgeColorFor(agent.name);
      displayContent = agent.body;
    }
  }

  // When a deliverable is attached, the raw fenced code is redundant with the artifact card.
  // Collapse the bubble text to whatever prose surrounds the fenced block (or a default completion note).
  if (hasDeliverables) {
    const trimmed = stripFencedArtifactContent(displayContent);
    displayContent = trimmed.length > 0 ? trimmed : 'Prepared the file below.';
  }

  // Status-based border styling
  const statusBorder =
    status === 'failed'
      ? 'border-l-2 border-red-400/40'
      : status === 'interrupted'
        ? 'border-l-2 border-amber-400/40'
        : '';

  return (
    <div data-role={role} className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      {/* Agent identity badge */}
      {badgeLabel && (
        <span
          className={cn(
            'inline-block mb-0.5 px-1.5 py-px rounded text-[10px] font-medium leading-tight',
            badgeColor,
          )}
        >
          {badgeLabel}
        </span>
      )}
      {/* Reasoning collapsible section */}
      {reasoning && (
        <div className="mb-1 max-w-[94%] rounded-xl border border-indigo-400/20 bg-indigo-500/8 px-3 py-1.5 text-xs leading-snug text-indigo-100">
          <button
            type="button"
            className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-indigo-200/80 cursor-pointer"
            onClick={() => setReasoningOpen((o) => !o)}
          >
            <span
              className={cn(
                'inline-block transition-transform text-[8px]',
                reasoningOpen ? 'rotate-90' : '',
              )}
            >
              ▶
            </span>
            Reasoning
          </button>
          {reasoningOpen && <div className="whitespace-pre-wrap">{reasoning}</div>}
        </div>
      )}
      <div
        className={cn(
          'max-w-[94%] px-3 py-1.5 text-sm leading-snug whitespace-pre-wrap rounded-xl',
          isUser ? 'bg-blue-600/20 text-slate-100' : 'bg-white/5 text-slate-200',
          statusBorder,
        )}
      >
        {isUser ? displayContent : renderWithCitations(displayContent)}
        {/* Status label */}
        {status === 'failed' && (
          <div className="mt-1 text-[10px] font-medium text-red-400/70">Failed</div>
        )}
        {status === 'interrupted' && (
          <div className="mt-1 text-[10px] font-medium text-amber-400/70">Interrupted</div>
        )}
      </div>
      {hasDeliverables && deliverables && (
        <div className="flex w-full flex-col">
          {deliverables.map((d) => (
            <DeliverableCard key={d.id} item={d} variant="compact" />
          ))}
        </div>
      )}
    </div>
  );
}
