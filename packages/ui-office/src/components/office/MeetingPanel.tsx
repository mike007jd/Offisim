import { Badge, ScrollArea, cn } from '@offisim/ui-core';
import {
  AlertTriangle,
  CheckSquare,
  ClipboardCheck,
  Lightbulb,
  type LucideProps,
  Rocket,
  Users,
} from 'lucide-react';
import { type FC, useEffect, useRef } from 'react';
import { useMeeting } from '../../hooks/useMeeting';
import type { MeetingActionItem } from '../../hooks/useMeeting';
import type { AgentState } from '../../runtime/use-agent-states';
import type { MeetingType } from './MeetingControls';
import { MeetingControlsAutoWired } from './MeetingControlsAutoWired';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MEETING_TYPE_META: Record<MeetingType, { label: string; Icon: FC<LucideProps> }> = {
  brainstorm: { label: 'Brainstorm', Icon: Lightbulb },
  kickoff: { label: 'Kickoff', Icon: Rocket },
  standup: { label: 'Standup', Icon: Users },
  review: { label: 'Review', Icon: ClipboardCheck },
};

const PRIORITY_COLORS: Record<MeetingActionItem['priority'], string> = {
  high: 'text-danger',
  medium: 'text-warn',
  low: 'text-ink-3',
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ParticipantDot({
  participantId,
  agents,
}: {
  participantId: string;
  agents: Map<string, AgentState>;
}) {
  const agent = agents.get(participantId);
  const name = agent?.name ?? participantId;
  const isActive = agent?.state !== 'idle' && agent?.state !== undefined;
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative flex-shrink-0" title={name}>
      <div
        className={cn(
          'flex size-5 items-center justify-center rounded-r-pill text-fs-micro font-semibold',
          isActive
            ? 'bg-accent-surface text-accent ring-1 ring-accent/60'
            : 'bg-surface-2 text-ink-3',
        )}
      >
        {initials}
      </div>
      {isActive && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-ok" />}
    </div>
  );
}

function ActionItemRow({
  item,
  agents,
}: { item: MeetingActionItem; agents: Map<string, AgentState> }) {
  const assignee = agents.get(item.assigneeEmployeeId);
  const assigneeName = assignee?.name ?? item.assigneeEmployeeId;

  return (
    <div className="flex items-start gap-sp-1 py-sp-1">
      <CheckSquare className={cn('mt-0.5 size-3 flex-shrink-0', PRIORITY_COLORS[item.priority])} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-fs-micro text-ink-2">{item.description}</p>
        <p className="text-fs-micro text-ink-3">→ {assigneeName}</p>
      </div>
      <span
        className={cn(
          'flex-shrink-0 text-fs-micro font-semibold uppercase tracking-ls-caps',
          PRIORITY_COLORS[item.priority],
        )}
      >
        {item.priority}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export interface MeetingPanelProps {
  /** Current meeting type selection (controlled by parent). */
  meetingType?: MeetingType;
  /** Agent states map from useAgentStates, used to display names. */
  agents?: Map<string, AgentState>;
}

/**
 * MeetingPanel — real-time meeting view.
 *
 * Wraps MeetingControlsAutoWired and adds:
 * - Status header with type badge and live timer
 * - Participant list with active indicators
 * - Scrollable transcript feed
 * - Action items checklist
 *
 * Renders nothing when no meeting is active (status === 'idle').
 */
export function MeetingPanel({
  meetingType = 'brainstorm',
  agents = new Map(),
}: MeetingPanelProps) {
  const { meetingState, duration, isActive } = useMeeting();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom on new entries
  // biome-ignore lint/correctness/useExhaustiveDependencies: transcript length triggers scroll
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [meetingState.transcript.length]);

  if (!isActive) {
    return null;
  }

  const { status, participantIds, actions, transcript } = meetingState;
  const meta = MEETING_TYPE_META[meetingType];
  const MetaIcon = meta.Icon;

  const statusBadgeVariant: 'success' | 'warning' | 'default' =
    status === 'running' ? 'success' : status === 'paused' ? 'warning' : 'default';

  return (
    <div className="flex flex-col gap-sp-2 border-t border-line-soft px-sp-2 py-sp-2">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sp-1">
          <MetaIcon className="size-3 text-ink-3" />
          <span className="text-fs-micro font-medium text-ink-2">{meta.label}</span>
        </div>
        <div className="flex items-center gap-sp-1">
          {duration !== null && (
            <span className="font-mono text-fs-micro text-ink-3 tabular-nums">
              {formatDuration(duration)}
            </span>
          )}
          <Badge variant={statusBadgeVariant}>{status === 'running' ? 'Live' : 'Paused'}</Badge>
        </div>
      </div>

      {/* ── Participants ────────────────────────────────────────────── */}
      {participantIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-sp-1">
          <span className="text-fs-micro uppercase tracking-ls-caps text-ink-3">In room</span>
          {participantIds.map((id) => (
            <ParticipantDot key={id} participantId={id} agents={agents} />
          ))}
          <span className="text-fs-micro text-ink-3">
            {participantIds.length} {participantIds.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}

      {/* ── Transcript ──────────────────────────────────────────────── */}
      {transcript.length > 0 && (
        <div>
          <p className="mb-sp-1 text-fs-micro uppercase tracking-ls-caps text-ink-3">Transcript</p>
          <ScrollArea className="max-h-20 pr-1">
            <div className="flex flex-col gap-sp-1">
              {transcript.map((entry) => {
                const speaker = agents.get(entry.participantId);
                const speakerName = speaker?.name ?? entry.participantId;
                return (
                  <div key={entry.id} className="flex gap-sp-1">
                    <span className="flex-shrink-0 text-fs-micro font-semibold text-accent">
                      {speakerName}:
                    </span>
                    <span className="text-fs-micro leading-tight text-ink-2">{entry.content}</span>
                  </div>
                );
              })}
              <div ref={transcriptEndRef} />
            </div>
          </ScrollArea>
        </div>
      )}

      {/* ── Action items ─────────────────────────────────────────────── */}
      {actions.length > 0 && (
        <div>
          <p className="mb-sp-1 text-fs-micro uppercase tracking-ls-caps text-ink-3">
            Actions ({actions.length})
          </p>
          <div className="flex flex-col gap-sp-1">
            {actions.map((item) => (
              <ActionItemRow key={item.actionItemId} item={item} agents={agents} />
            ))}
          </div>
        </div>
      )}

      {/* No transcript yet indicator */}
      {transcript.length === 0 && actions.length === 0 && (
        <div className="flex items-center gap-sp-1 text-fs-micro text-ink-3">
          <AlertTriangle className="size-3" />
          <span>Waiting for discussion...</span>
        </div>
      )}

      {/* ── Controls (pause / resume / end / inject) ─────────────────── */}
      <MeetingControlsAutoWired meetingId={meetingState.meetingId} status={status} />
    </div>
  );
}
