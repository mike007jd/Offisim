import { Badge, ScrollArea } from '@offisim/ui-core';
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
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-slate-400',
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
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
          isActive
            ? 'bg-blue-500/30 text-blue-300 ring-1 ring-blue-400/60'
            : 'bg-slate-700 text-slate-400'
        }`}
      >
        {initials}
      </div>
      {isActive && (
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-green-400" />
      )}
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
    <div className="flex items-start gap-1.5 py-0.5">
      <CheckSquare className={`mt-0.5 h-3 w-3 flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-slate-300">{item.description}</p>
        <p className="text-[10px] text-slate-500">→ {assigneeName}</p>
      </div>
      <span
        className={`flex-shrink-0 text-[10px] uppercase tracking-wider font-semibold ${PRIORITY_COLORS[item.priority]}`}
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
    <div className="flex flex-col gap-2 border-t border-white/5 px-2 py-2">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MetaIcon className="h-3 w-3 text-slate-400" />
          <span className="text-xs font-medium text-slate-300">{meta.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {duration !== null && (
            <span
              className="font-mono text-[10px] text-slate-500"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatDuration(duration)}
            </span>
          )}
          <Badge variant={statusBadgeVariant}>{status === 'running' ? 'Live' : 'Paused'}</Badge>
        </div>
      </div>

      {/* ── Participants ────────────────────────────────────────────── */}
      {participantIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">In room</span>
          {participantIds.map((id) => (
            <ParticipantDot key={id} participantId={id} agents={agents} />
          ))}
          <span className="text-[10px] text-slate-500">
            {participantIds.length} {participantIds.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}

      {/* ── Transcript ──────────────────────────────────────────────── */}
      {transcript.length > 0 && (
        <div>
          <p className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">Transcript</p>
          <ScrollArea className="max-h-20 pr-1">
            <div className="flex flex-col gap-0.5">
              {transcript.map((entry) => {
                const speaker = agents.get(entry.participantId);
                const speakerName = speaker?.name ?? entry.participantId;
                return (
                  <div key={entry.id} className="flex gap-1">
                    <span className="flex-shrink-0 text-[10px] font-semibold text-blue-400/80">
                      {speakerName}:
                    </span>
                    <span className="text-xs text-slate-400 leading-tight">{entry.content}</span>
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
          <p className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            Actions ({actions.length})
          </p>
          <div className="flex flex-col gap-0.5">
            {actions.map((item) => (
              <ActionItemRow key={item.actionItemId} item={item} agents={agents} />
            ))}
          </div>
        </div>
      )}

      {/* No transcript yet indicator */}
      {transcript.length === 0 && actions.length === 0 && (
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <AlertTriangle className="h-3 w-3" />
          <span>Waiting for discussion...</span>
        </div>
      )}

      {/* ── Controls (pause / resume / end / inject) ─────────────────── */}
      <MeetingControlsAutoWired meetingId={meetingState.meetingId} status={status} />
    </div>
  );
}
