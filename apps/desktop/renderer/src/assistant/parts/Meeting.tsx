import { useEmployees } from '@/data/queries.js';
import type { ActionItemPriority, MeetingState } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { useComposerRuntime } from '@assistant-ui/react';
import { ArrowRight, Check, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useRunStore } from '../run-store.js';

const PRIORITY_TONE: Record<ActionItemPriority, string> = {
  high: 'is-high',
  medium: 'is-medium',
  low: 'is-low',
};

function useEmployeesById() {
  const employees = useEmployees();
  return useMemo(() => new Map((employees.data ?? []).map((e) => [e.id, e])), [employees.data]);
}

/** In-conversation meeting follow-up. Each action item can be checked off or
 *  delegated — Delegate pre-fills the composer with `@name description`, the
 *  prototype's one-tap hand-off. */
function MeetingActionItems({ meeting }: { meeting: MeetingState }) {
  const byId = useEmployeesById();
  const toggle = useRunStore((s) => s.toggleActionItem);
  const composer = useComposerRuntime();

  return (
    <section className="off-meeting-items">
      <div className="off-rail-sec-head">
        Meeting follow-up
        <span className="off-rail-sec-count">{meeting.actionItems.length}</span>
      </div>
      {meeting.actionItems.map((item) => {
        const assignee = item.assigneeId ? byId.get(item.assigneeId) : undefined;
        return (
          <div key={item.id} className={cn('off-action-item', item.done && 'is-done')}>
            <button
              type="button"
              className="off-action-check off-focusable"
              aria-pressed={item.done}
              aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
              onClick={() => toggle(item.id)}
            >
              {item.done ? <Icon icon={Check} size="sm" /> : null}
            </button>
            <span className="off-action-desc">{item.description}</span>
            <span className={cn('off-action-prio', PRIORITY_TONE[item.priority])}>
              {item.priority}
            </span>
            {assignee ? (
              <span className="off-action-assignee">
                <Icon icon={ArrowRight} size="sm" />
                <EmployeeAvatar
                  seed={assignee.id}
                  appearance={assignee.appearance}
                  colorA={assignee.avatarA}
                  colorB={assignee.avatarB}
                  size={18}
                  brand={assignee.kind === 'external'}
                />
              </span>
            ) : null}
            <button
              type="button"
              className="off-action-delegate off-focusable"
              onClick={() => composer.setText(`@${assignee?.name ?? 'team'} ${item.description}`)}
            >
              Delegate
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** Active meeting panel (running / paused): who's in the room, the live
 *  transcript, and the action items being captured. */
function MeetingPanel({ meeting }: { meeting: MeetingState }) {
  const byId = useEmployeesById();
  return (
    <section className={cn('off-meeting-panel', `is-${meeting.status}`)}>
      <header className="off-meeting-head">
        <Icon icon={Users} size="sm" />
        <span className="off-meeting-title">{meeting.title}</span>
        <span className="off-meeting-status">{meeting.status}</span>
        <span className="off-meeting-room">
          {meeting.inRoomIds.map((id) => {
            const e = byId.get(id);
            if (!e) return null;
            return (
              <EmployeeAvatar
                key={id}
                seed={e.id}
                appearance={e.appearance}
                colorA={e.avatarA}
                colorB={e.avatarB}
                size={18}
                brand={e.kind === 'external'}
              />
            );
          })}
        </span>
      </header>
      <div className="off-meeting-body">
        <div className="off-meeting-transcript">
          <CapsLabel>Transcript</CapsLabel>
          {meeting.transcript.map((line) => (
            <p key={line.id} className="off-meeting-line">
              <b>{line.speakerId ? (byId.get(line.speakerId)?.name ?? '—') : '—'}</b> {line.text}
            </p>
          ))}
        </div>
      </div>
      <MeetingActionItems meeting={meeting} />
    </section>
  );
}

/** Meeting region for the conversation: a live panel while the meeting runs, or
 *  just the follow-up action items once it ends (idle). */
export function MeetingRegion() {
  const meeting = useRunStore((s) => s.meeting);
  if (!meeting) return null;
  if (meeting.status === 'idle') return <MeetingActionItems meeting={meeting} />;
  return <MeetingPanel meeting={meeting} />;
}
