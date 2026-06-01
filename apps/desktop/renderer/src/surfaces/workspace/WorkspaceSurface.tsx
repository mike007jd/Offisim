import { type WorkspaceApp, useUiState } from '@/app/ui-state.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  CalendarDays,
  CheckSquare,
  LayoutGrid,
  type LucideIcon,
  MessageSquare,
  Users,
} from 'lucide-react';
import { ApprovalsApp } from './apps/ApprovalsApp.js';
import { CalendarApp } from './apps/CalendarApp.js';
import { ContactsApp } from './apps/ContactsApp.js';
import { MessengerApp } from './apps/MessengerApp.js';
import { WorkplaceApp } from './apps/WorkplaceApp.js';
import { useWsApprovals, useWsConversations } from './workspace-data.js';

type AppEntry = { key: WorkspaceApp; label: string; icon: LucideIcon };

// Tiered rail: action apps (carry badges) lead, then browse apps, then the
// overview at the bottom — so the rail reads by priority, not as six equals.
const APP_GROUPS: ReadonlyArray<ReadonlyArray<AppEntry>> = [
  [
    { key: 'messenger', label: 'Chats', icon: MessageSquare },
    { key: 'approvals', label: 'Approve', icon: CheckSquare },
  ],
  [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'contacts', label: 'Contacts', icon: Users },
  ],
  [{ key: 'workplace', label: 'Workplace', icon: LayoutGrid }],
];

function AppRail() {
  const app = useUiState((s) => s.workspaceApp);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const approvals = useWsApprovals();
  const conversations = useWsConversations();

  const toDo = approvals.data?.filter((a) => a.status === 'pending').length ?? 0;
  const unread = (conversations.data ?? []).reduce((sum, c) => sum + (c.unread ?? 0), 0);

  function badgeFor(key: WorkspaceApp): { count?: number; dot?: boolean } {
    if (key === 'messenger') return unread > 0 ? { count: unread } : {};
    if (key === 'approvals') return toDo > 0 ? { count: toDo } : {};
    // Calendar carries a no-count attention dot (events waiting today).
    if (key === 'calendar') return { dot: true };
    return {};
  }

  return (
    <nav className="off-ws-rail" aria-label="Workspace apps">
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
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn('off-ws-rail-btn off-focusable', app === item.key && 'is-active')}
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
      {app === 'approvals' ? <ApprovalsApp /> : null}
      {app === 'calendar' ? <CalendarApp /> : null}
      {app === 'contacts' ? <ContactsApp /> : null}
      {app === 'workplace' ? <WorkplaceApp /> : null}
    </div>
  );
}
