import { type WorkspaceApp, useUiState } from '@/app/ui-state.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { CalendarDays, type LucideIcon, MessageSquare, Users } from 'lucide-react';
import { CalendarApp } from './apps/CalendarApp.js';
import { ContactsApp } from './apps/ContactsApp.js';
import { MessengerApp } from './apps/MessengerApp.js';
import { useConnectThreads } from './collaboration-data.js';
import { useWsAgenda } from './workspace-data.js';

type AppEntry = { key: WorkspaceApp; label: string; icon: LucideIcon };

// Tiered rail: communication leads, then the two supporting browse apps.
const APP_GROUPS: ReadonlyArray<ReadonlyArray<AppEntry>> = [
  [{ key: 'messenger', label: 'Chats', icon: MessageSquare }],
  [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'contacts', label: 'Contacts', icon: Users },
  ],
];

function AppRail() {
  const app = useUiState((s) => s.workspaceApp);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const companyId = useUiState((s) => s.companyId) || null;
  // Connect (collaboration) unread, not the legacy project-chat count — the Chats
  // rail badge must reflect the same aggregate the Messenger list shows.
  const threads = useConnectThreads(companyId);
  const agenda = useWsAgenda();

  const unread = (threads.data ?? []).reduce((sum, t) => sum + (t.unreadCount ?? 0), 0);
  // Real signal, not a hardcoded dot: only light Calendar when today actually
  // has events (shares the cached ['ws','agenda'] query with CalendarApp).
  const hasToday = (agenda.data ?? []).some((d) => d.today && d.events.length > 0);

  function badgeFor(key: WorkspaceApp): { count?: number; dot?: boolean } {
    if (key === 'messenger') return unread > 0 ? { count: unread } : {};
    if (key === 'calendar') return hasToday ? { dot: true } : {};
    return {};
  }

  return (
    <nav className="off-ws-rail" aria-label="Connect">
      <span className="off-ws-rail-id" title="You">
        <EmployeeAvatar
          seed="Boss"
          colorA={UI_DATA_COLORS.bossA}
          colorB={UI_DATA_COLORS.bossB}
          size={34}
        />
      </span>
      <div className="off-ws-rail-apps">
        {APP_GROUPS.map((group, groupIndex) => (
          <div key={group[0]?.key ?? groupIndex} className="off-ws-rail-group">
            {groupIndex > 0 ? <span className="off-ws-rail-sep" aria-hidden /> : null}
            {group.map((item) => {
              const badge = badgeFor(item.key);
              const active = app === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn('off-ws-rail-btn off-focusable', active && 'is-active')}
                  onClick={() => setApp(item.key)}
                >
                  <span className="off-ws-rail-icon">
                    <Icon icon={item.icon} size="md" />
                    {badge.count ? <span className="off-ws-rail-badge">{badge.count}</span> : null}
                    {badge.dot ? <span className="off-ws-rail-badge is-dot" /> : null}
                  </span>
                  <span className="off-ws-rail-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function WorkspaceSurface() {
  const app = useUiState((s) => s.workspaceApp);

  return (
    <div className="off-ws">
      <AppRail />
      {app === 'messenger' ? <MessengerApp /> : null}
      {app === 'calendar' ? <CalendarApp /> : null}
      {app === 'contacts' ? <ContactsApp /> : null}
    </div>
  );
}
