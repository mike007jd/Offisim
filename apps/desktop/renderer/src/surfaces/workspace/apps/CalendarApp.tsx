import { useUiState } from '@/app/ui-state.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Check, MessageSquare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type AgendaEvent, type WsMeeting, useWsAgenda, useWsMeetings } from '../workspace-data.js';

type View = 'agenda' | 'week';

const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'week', label: 'Week' },
];

const STATUS_TONE: Record<WsMeeting['status'], 'accent' | 'ok' | 'muted'> = {
  live: 'accent',
  upcoming: 'ok',
  ended: 'muted',
};

/** Agenda events that surface a meeting card on the right when picked. */
const EVENT_TO_MEETING: Record<string, string> = {
  'ev-standup': 'mtg-standup',
  'ev-design': 'mtg-design',
  'ev-signoff': 'mtg-signoff',
};

export function CalendarApp() {
  const agenda = useWsAgenda();
  const meetings = useWsMeetings();
  const employees = useEmployees();
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const [view, setView] = useState<View>('agenda');

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const days = agenda.data ?? [];
  const meetingList = meetings.data ?? [];

  // The selected event id (defaults to first event that maps to a meeting).
  const firstMeetingEvent =
    days.flatMap((d) => d.events).find((e) => EVENT_TO_MEETING[e.id])?.id ?? null;
  const activeEventId = selectedId ?? firstMeetingEvent;
  const meetingId = activeEventId ? EVENT_TO_MEETING[activeEventId] : undefined;
  const meeting: WsMeeting | null = meetingId
    ? (meetingList.find((m) => m.id === meetingId) ?? null)
    : (meetingList[0] ?? null);

  function EventRow({ ev }: { ev: AgendaEvent }) {
    const selectable = Boolean(EVENT_TO_MEETING[ev.id]);
    return (
      <button
        type="button"
        className={cn(
          'off-ws-evt off-focusable',
          `is-${ev.kind}`,
          activeEventId === ev.id && 'is-active',
          !selectable && 'is-static',
        )}
        onClick={() => selectable && selectItem(ev.id)}
      >
        <span className="off-ws-evt-bar" />
        <span className="off-ws-evt-main">
          <span className="off-ws-evt-t">{ev.title}</span>
          <span className="off-ws-evt-sub">
            <span className="off-ws-evt-tm">{ev.timeLabel}</span> · {ev.note}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="off-ws-detail off-ws-detail-full off-ws-cal">
      <div className="off-ws-cal-head">
        <span className="off-ws-cal-ttl">This week</span>
        <SegmentedControl
          options={VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="Calendar view"
        />
        <button
          type="button"
          className="off-ws-oa-deny off-focusable"
          onClick={() => setView('agenda')}
        >
          Today
        </button>
        <span className="off-grow" />
        <span className="off-ws-preview-tag">Preview</span>
      </div>

      <div className="off-ws-cal-body">
        <div className="off-ws-agenda">
          {days.map((day) => (
            <div key={day.id} className="off-ws-ag-day">
              <div className={cn('off-ws-ag-date', day.today && 'is-today')}>
                {day.weekday}
                <span>{day.date}</span>
              </div>
              <div className="off-ws-ag-evts">
                {day.events.map((ev) => (
                  <EventRow key={ev.id} ev={ev} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {meeting ? (
          <div className="off-ws-meet">
            <div className="off-ws-meet-h">
              <div className="min-w-0">
                <div className="off-ws-meet-t">{meeting.title}</div>
                <div className="off-ws-meet-s">{meeting.sub}</div>
              </div>
              <StatusPill tone={STATUS_TONE[meeting.status]} running={meeting.status === 'live'}>
                {meeting.status}
              </StatusPill>
            </div>
            <div className="off-ws-meet-b">
              {meeting.attendeeIds.length ? (
                <div className="off-ws-attendees">
                  {meeting.attendeeIds.map((id) => {
                    const e = byId.get(id);
                    if (!e) return null;
                    return (
                      <span key={id} className="off-ws-attendee">
                        <EmployeeAvatar
                          seed={e.id}
                          appearance={e.appearance}
                          colorA={e.avatarA}
                          colorB={e.avatarB}
                          size={20}
                          brand={e.kind === 'external'}
                        />
                        {e.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <div className="off-ws-meet-sec-head">
                Action items <span className="off-ws-seg-ct">{meeting.actionItems.length}</span>
              </div>
              {meeting.actionItems.map((item) => {
                const done = item.done;
                const owner = item.ownerId ? byId.get(item.ownerId) : null;
                return (
                  <div key={item.id} className={cn('off-ws-ai', done && 'is-done')}>
                    <span className="off-ws-ai-box">
                      {done ? <Icon icon={Check} size="sm" /> : null}
                    </span>
                    <span className="off-ws-ai-tx">{item.text}</span>
                    <span className="off-ws-ai-who">
                      {owner ? (
                        <EmployeeAvatar
                          seed={owner.id}
                          appearance={owner.appearance}
                          colorA={owner.avatarA}
                          colorB={owner.avatarB}
                          size={16}
                          brand={owner.kind === 'external'}
                        />
                      ) : (
                        <EmployeeAvatar
                          seed="Boss"
                          colorA={UI_DATA_COLORS.bossA}
                          colorB={UI_DATA_COLORS.bossB}
                          size={16}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
              <button
                type="button"
                className="off-ws-dlv-btn off-ws-meet-open off-focusable"
                onClick={() => {
                  setApp('messenger', meeting.threadId);
                }}
              >
                <Icon icon={MessageSquare} size="sm" />
                Open meeting thread
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
