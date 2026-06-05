import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { CalendarDays, Check, MessageSquare } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { type AgendaEvent, type WsMeeting, useWsAgenda, useWsMeetings } from '../workspace-data.js';

/** real agenda event ids are `mtg-ev-<meeting_id>`. */
const MEETING_EVENT_PREFIX = 'mtg-ev-';
function meetingIdForEvent(eventId: string | null): string | undefined {
  if (eventId?.startsWith(MEETING_EVENT_PREFIX)) return eventId.slice(MEETING_EVENT_PREFIX.length);
  return eventId ? FIXTURE_EVENT_TO_MEETING[eventId] : undefined;
}

const STATUS_TONE: Record<WsMeeting['status'], 'accent' | 'ok' | 'muted'> = {
  live: 'accent',
  upcoming: 'ok',
  ended: 'muted',
};

/** Browser-preview-only: maps the demo agenda fixture event ids to fixture
 *  meeting ids. Release agenda events use the `mtg-ev-<id>` derived ids above. */
const FIXTURE_EVENT_TO_MEETING: Record<string, string> = {
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
  const todayRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const days = agenda.data ?? [];
  const meetingList = meetings.data ?? [];
  const hasToday = days.some((d) => d.today);

  // The selected event id (defaults to the first event that maps to a meeting).
  const firstMeetingEvent =
    days.flatMap((d) => d.events).find((e) => meetingIdForEvent(e.id))?.id ?? null;
  const activeEventId = selectedId ?? firstMeetingEvent;
  const meetingId = meetingIdForEvent(activeEventId);
  const meeting: WsMeeting | null = meetingId
    ? (meetingList.find((m) => m.id === meetingId) ?? null)
    : (meetingList[0] ?? null);

  function EventRow({ ev }: { ev: AgendaEvent }) {
    const selectable = Boolean(meetingIdForEvent(ev.id));
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
        <button
          type="button"
          className="off-ws-cal-today off-focusable"
          disabled={!hasToday}
          onClick={() => todayRef.current?.scrollIntoView({ block: 'nearest' })}
        >
          Today
        </button>
        <span className="off-grow" />
        {!isTauriRuntime() ? <span className="off-ws-preview-tag">Preview</span> : null}
      </div>

      {agenda.isError ? (
        <ErrorState
          title="Couldn't load the calendar"
          detail={errorDetail(agenda.error, 'The agenda failed to load.')}
          onRetry={() => void agenda.refetch()}
          className="off-ws-detail-full"
        />
      ) : days.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No meetings yet"
          description="Meetings your team runs appear here, grouped by day."
          className="off-ws-detail-full"
        />
      ) : (
        <div className="off-ws-cal-body">
          <div className="off-ws-agenda">
            {days.map((day) => (
              <div key={day.id} className="off-ws-ag-day">
                <div
                  ref={day.today ? todayRef : undefined}
                  className={cn('off-ws-ag-date', day.today && 'is-today')}
                >
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
                {meeting.actionItems.length > 0 ? (
                  <>
                    <div className="off-ws-meet-sec-head">
                      Action items{' '}
                      <span className="off-ws-seg-ct">{meeting.actionItems.length}</span>
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
                  </>
                ) : null}
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
      )}
    </div>
  );
}
