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
    <div className="meeting-participant" data-active={isActive ? 'true' : 'false'} title={name}>
      <div>{initials}</div>
      {isActive && <span />}
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
    <div className="meeting-action-row" data-priority={item.priority}>
      <CheckSquare data-icon="priority" aria-hidden="true" />
      <div>
        <p>{item.description}</p>
        <p data-slot="assignee">→ {assigneeName}</p>
      </div>
      <span>{item.priority}</span>
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
    <div className="meeting-panel">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="meeting-panel-header">
        <div>
          <MetaIcon data-icon="meeting-type" aria-hidden="true" />
          <span>{meta.label}</span>
        </div>
        <div>
          {duration !== null && <span data-slot="timer">{formatDuration(duration)}</span>}
          <Badge variant={statusBadgeVariant}>{status === 'running' ? 'Live' : 'Paused'}</Badge>
        </div>
      </div>

      {/* ── Participants ────────────────────────────────────────────── */}
      {participantIds.length > 0 && (
        <div className="meeting-participants">
          <span data-slot="label">In room</span>
          {participantIds.map((id) => (
            <ParticipantDot key={id} participantId={id} agents={agents} />
          ))}
          <span data-slot="count">
            {participantIds.length} {participantIds.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}

      {/* ── Transcript ──────────────────────────────────────────────── */}
      {transcript.length > 0 && (
        <div className="meeting-section">
          <p data-slot="label">Transcript</p>
          <ScrollArea className="meeting-transcript-scroll">
            <div className="meeting-transcript-list">
              {transcript.map((entry) => {
                const speaker = agents.get(entry.participantId);
                const speakerName = speaker?.name ?? entry.participantId;
                return (
                  <div key={entry.id} className="meeting-transcript-row">
                    <span data-slot="speaker">{speakerName}:</span>
                    <span data-slot="content">{entry.content}</span>
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
        <div className="meeting-section">
          <p data-slot="label">Actions ({actions.length})</p>
          <div className="meeting-actions">
            {actions.map((item) => (
              <ActionItemRow key={item.actionItemId} item={item} agents={agents} />
            ))}
          </div>
        </div>
      )}

      {/* No transcript yet indicator */}
      {transcript.length === 0 && actions.length === 0 && (
        <div className="meeting-waiting">
          <AlertTriangle data-icon="waiting" aria-hidden="true" />
          <span>Waiting for discussion...</span>
        </div>
      )}

      {/* ── Controls (pause / resume / end / inject) ─────────────────── */}
      <MeetingControlsAutoWired meetingId={meetingState.meetingId} status={status} />
    </div>
  );
}
