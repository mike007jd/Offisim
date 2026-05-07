import type { ChatAttachmentRef } from '@offisim/shared-types';
import { cn } from '@offisim/ui-core';
import { ChevronRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { Deliverable } from '../../hooks/useDeliverables';
import {
  DEFAULT_BADGE_COLOR,
  NODE_BADGE_COLORS,
  getBadgeColorForDisplayName,
  humanizeNodeName,
} from '../../lib/agent-display';
import type { AttachmentStore } from '../../lib/attachment-store.js';
import { stripLegacySpeakerPrefix } from '../../lib/legacy-speaker-prefix';
import { DeliverableCard } from '../deliverable/DeliverableCard';
import { MarkdownContent } from './MarkdownContent';
import { SentAttachmentChip } from './SentAttachmentChip.js';
import type { MessageStatus } from './chat-session-store';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: MessageStatus;
  nodeName?: string | null;
  reasoning?: string;
  deliverables?: Deliverable[];
  attachments?: ChatAttachmentRef[];
  attachmentStore?: AttachmentStore | null;
}

const FILENAME_LINE = /(^|\n)\s*Filename\s*:\s*[^\n]+\s*(?=\n|$)/gi;
const FENCED_CODE_BLOCK_RE = /```[a-zA-Z0-9#+._-]*\s*\n[\s\S]*?\n```/g;
const USER_MESSAGE_MAX_WIDTH_STYLE = {
  maxWidth: 'min(32rem, calc(100% - 2rem))',
} satisfies CSSProperties;

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

// ── Component ──────────────────────────────────────────────────────

export function MessageBubble({
  role,
  content,
  status,
  nodeName,
  reasoning,
  deliverables,
  attachments,
  attachmentStore,
}: MessageBubbleProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const hasDeliverables = !!deliverables && deliverables.length > 0;
  const hasAttachments = !!attachments && attachments.length > 0;
  const trimmedContent = content.trim();
  const isAttachmentOnly = role === 'user' && hasAttachments && trimmedContent.length === 0;

  // System messages: full-width, monospace, no avatar
  if (role === 'system') {
    return (
      <div data-role="system" className="w-full min-w-0 max-w-full overflow-hidden px-1 py-1">
        <div className="min-w-0 max-w-full overflow-hidden break-words whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-muted">
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
  return (
    <div
      data-role={role}
      className={cn(
        'flex w-full min-w-0 max-w-full flex-col overflow-hidden py-1',
        isUser ? 'items-center' : 'items-start',
      )}
    >
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
        <div className="mb-1 w-full min-w-0 max-w-full overflow-hidden border-l-2 border-info/55 px-2 py-1 text-xs leading-snug text-text-primary">
          <button
            type="button"
            className="mb-1 flex cursor-pointer items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-info transition-colors hover:text-text-primary"
            onClick={() => setReasoningOpen((o) => !o)}
          >
            <ChevronRight
              className={cn('h-3 w-3 transition-transform', reasoningOpen && 'rotate-90')}
            />
            Reasoning
          </button>
          {reasoningOpen && (
            <MarkdownContent
              content={reasoning}
              className="min-w-0 max-w-full break-words text-xs leading-relaxed"
            />
          )}
        </div>
      )}
      {!isAttachmentOnly && (
        <div
          style={isUser ? USER_MESSAGE_MAX_WIDTH_STYLE : undefined}
          className={cn(
            'min-w-0 overflow-hidden break-words text-sm leading-relaxed',
            isUser
              ? 'mx-auto w-fit max-w-full rounded-xl bg-accent-muted px-3 py-1.5 text-accent-text'
              : 'w-full max-w-full px-1 py-0.5 text-text-primary',
            !isUser && status === 'failed' ? 'border-l-2 border-error pl-2' : '',
            !isUser && status === 'interrupted' ? 'border-l-2 border-warning pl-2' : '',
          )}
        >
          <MarkdownContent content={displayContent} className="min-w-0 max-w-full" />
          {/* Status label */}
          {status === 'failed' && (
            <div className="mt-1 text-[10px] font-medium text-error">Failed</div>
          )}
          {status === 'interrupted' && (
            <div className="mt-1 text-[10px] font-medium text-warning">Interrupted</div>
          )}
        </div>
      )}
      {hasAttachments && attachments && (
        <div
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))',
            ...(isUser ? USER_MESSAGE_MAX_WIDTH_STYLE : {}),
          }}
          className={cn(
            'mt-1 grid w-full min-w-0 gap-1 overflow-hidden',
            isUser ? 'mx-auto max-w-full' : 'mr-auto max-w-full',
          )}
        >
          {attachments.map((a) => (
            <SentAttachmentChip
              key={a.attachmentId}
              attachment={a}
              attachmentStore={attachmentStore ?? null}
            />
          ))}
        </div>
      )}
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
