import { useUiState } from '@/app/ui-state.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { StatusPill } from '@/design-system/grammar/StatusPill.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Check, MessageSquare, Video } from 'lucide-react';
import { useMemo } from 'react';
import { type WsMeeting, useWsMeetings } from '../workspace-data.js';

const STATUS_TONE: Record<WsMeeting['status'], 'accent' | 'ok' | 'muted'> = {
  live: 'accent',
  upcoming: 'ok',
  ended: 'muted',
};

export function MeetingsApp() {
  const meetings = useWsMeetings();
  const employees = useEmployees();
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setApp = useUiState((s) => s.setWorkspaceApp);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const list = meetings.data ?? [];
  const activeId = selectedId ?? list[0]?.id ?? null;
  const active = list.find((m) => m.id === activeId) ?? null;

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Meetings</span>
        </div>
        <div className="off-ws-rows">
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              className={cn('off-ws-row off-focusable', m.id === activeId && 'is-active')}
              onClick={() => selectItem(m.id)}
            >
              <span className="off-ws-row-icon" data-tone={STATUS_TONE[m.status]}>
                <Icon icon={Video} size="sm" />
              </span>
              <span className="off-ws-row-copy">
                <span className="off-ws-row-title">{m.title}</span>
                <span className="off-ws-row-sub">{m.timeLabel}</span>
              </span>
              <StatusPill tone={STATUS_TONE[m.status]} running={m.status === 'live'}>
                {m.status}
              </StatusPill>
            </button>
          ))}
        </div>
      </div>

      <div className="off-ws-detail">
        {active ? (
          <div className="off-ws-pad">
            <div className="off-ws-approval-head">
              <span className="off-ws-row-icon is-lg" data-tone={STATUS_TONE[active.status]}>
                <Icon icon={Video} size="md" />
              </span>
              <div>
                <span className="off-ws-detail-kind">{active.timeLabel}</span>
                <h2 className="off-ws-detail-title">{active.title}</h2>
              </div>
              <StatusPill tone={STATUS_TONE[active.status]} running={active.status === 'live'}>
                {active.status}
              </StatusPill>
            </div>

            <div className="off-ws-attendees">
              {active.attendeeIds.map((id) => {
                const e = byId.get(id);
                if (!e) return null;
                return (
                  <span key={id} className="off-ws-attendee">
                    <EmployeeAvatar
                      seed={e.id}
                      appearance={e.appearance}
                      colorA={e.avatarA}
                      colorB={e.avatarB}
                      size={22}
                      brand={e.kind === 'external'}
                    />
                    {e.name}
                  </span>
                );
              })}
            </div>

            <div className="off-ws-meet-sec-head">
              Action items <span className="off-ws-seg-ct">{active.actionItems.length}</span>
            </div>
            <div className="off-ws-meet-items">
              {active.actionItems.map((item) => {
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
            </div>

            <button
              type="button"
              className="off-ws-dlv-btn off-ws-meet-open off-focusable"
              onClick={() => {
                setApp('messenger', active.threadId);
              }}
            >
              <Icon icon={MessageSquare} size="sm" />
              Open meeting thread
            </button>
          </div>
        ) : (
          <EmptyState
            icon={Video}
            title="No meeting"
            description="Pick a meeting to see details."
          />
        )}
      </div>
    </>
  );
}
