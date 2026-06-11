import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useProjects } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  Eye,
  Megaphone,
  MessageSquare,
  Plus,
  Shield,
  Sparkles,
  Store,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import {
  type SysCard,
  type SysLevel,
  type SysSource,
  type WsConversation,
  useWsConversations,
  useWsSystemCards,
  useWsThread,
} from '../workspace-data.js';
import { WorkspaceAssistantThread } from './WorkspaceAssistantThread.js';

const PRESENCE_CLASS: Record<NonNullable<WsConversation['presence']>, string> = {
  working: 'is-working',
  idle: 'is-idle',
  blocked: 'is-blocked',
  offline: 'is-offline',
};

const SYS_LEVEL_ICON: Record<SysLevel, typeof Check> = {
  info: Store,
  success: Users,
  warning: AlertTriangle,
  error: X,
};

const SYS_SOURCE_LABEL: Record<SysSource, string> = {
  runtime: 'Runtime',
  hr: 'HR',
  market: 'Market',
  install: 'Install',
};

const SYS_SOURCE_ICON: Record<SysSource, typeof Store> = {
  runtime: AlertTriangle,
  hr: Users,
  market: Store,
  install: Plus,
};

function ConvAvatar({
  conv,
  employee,
  size = 40,
}: {
  conv: WsConversation;
  employee: Employee | null;
  size?: number;
}) {
  const avatarClass = cn('off-ws-im-av', size <= 30 && 'is-compact');
  if (conv.kind === 'group') {
    return (
      <span className={cn(avatarClass, 'is-group')}>
        <Icon icon={conv.id === 'th-design' ? Users : Building2} size="sm" />
      </span>
    );
  }
  if (conv.kind === 'system') {
    return (
      <span className={cn(avatarClass, 'is-bot')}>
        <Icon icon={Sparkles} size="sm" />
      </span>
    );
  }
  if (employee) {
    return (
      <span className={cn('off-ws-im-av-wrap', size <= 30 && 'is-compact')}>
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={size}
          brand={employee.kind === 'external'}
          className={cn('off-ws-im-av-emp', conv.kind === 'external' && 'is-ext')}
        />
        {conv.presence ? (
          <span className={cn('off-ws-pres', PRESENCE_CLASS[conv.presence])} />
        ) : null}
      </span>
    );
  }
  return (
    <span className={cn(avatarClass, 'is-group')}>
      <Icon icon={Bot} size="sm" />
    </span>
  );
}

function ConvRow({
  conv,
  active,
  employee,
  onSelect,
}: {
  conv: WsConversation;
  active: boolean;
  employee: Employee | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('off-ws-im-row off-focusable', active && 'is-active')}
      onClick={onSelect}
    >
      <ConvAvatar conv={conv} employee={employee} />
      <span className="off-ws-im-main">
        <span className="off-ws-im-l1">
          <span className="off-ws-im-name">{conv.title}</span>
          {conv.kind === 'system' ? <span className="off-ws-im-tag">bot</span> : null}
          {conv.kind === 'external' ? <span className="off-ws-im-tag">ext</span> : null}
          <span className="off-ws-im-time">{conv.timeLabel}</span>
        </span>
        <span className="off-ws-im-l2">
          <span className="off-ws-im-snip">{conv.snippet}</span>
          {conv.unread ? <span className="off-ws-im-nb">{conv.unread}</span> : null}
          {!conv.unread && conv.read ? (
            <span className="off-ws-im-rd">
              <Icon icon={Check} size="sm" />
            </span>
          ) : null}
          {!conv.unread && conv.muted ? (
            <span className="off-ws-im-mute">
              <Icon icon={Megaphone} size="sm" />
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function SystemChannel({
  cards,
  onOpenActivity,
}: { cards: SysCard[]; onOpenActivity: () => void }) {
  return (
    <>
      <header className="off-ws-chat-head">
        <span className="off-ws-ch-av is-bot">
          <Icon icon={Sparkles} size="sm" />
        </span>
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">System</span>
          <span className="off-ws-crumb-sub">Runtime · HR · Market · Install</span>
        </div>
        <div className="off-ws-chat-tools">
          <IconButton
            icon={Terminal}
            label="Open Activity Log"
            variant="ghost"
            size="iconSm"
            onClick={onOpenActivity}
          />
        </div>
      </header>
      <div className="off-ws-conv-scroll">
        <section className="off-ws-messages is-sys">
          <span className="off-ws-day-sep">Today</span>
          {cards.map((card) => {
            const LevelIcon = SYS_LEVEL_ICON[card.level];
            const SourceIcon = SYS_SOURCE_ICON[card.source];
            return (
              <div key={card.id} className={cn('off-ws-sys-card', `is-${card.level}`)}>
                <span className="off-ws-sys-ic">
                  <Icon
                    icon={card.source === 'hr' || card.source === 'market' ? SourceIcon : LevelIcon}
                    size="sm"
                  />
                </span>
                <div className="off-ws-sys-main">
                  <div className="off-ws-sys-l1">
                    <span className="off-ws-sys-src">{SYS_SOURCE_LABEL[card.source]}</span>
                    <span className="off-ws-sys-ttl">{card.title}</span>
                    <span className="off-ws-sys-tm">{card.timeLabel}</span>
                  </div>
                  <div className="off-ws-sys-msg">{card.message}</div>
                  {card.actions.length > 0 ? (
                    <div className="off-ws-sys-act">
                      {card.actions.map((action) => (
                        <span
                          key={action.id}
                          className={cn('off-ws-sys-chip', action.primary && 'is-primary')}
                          title="State from Activity Log"
                        >
                          {action.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      </div>
      <div className="off-ws-composer is-readonly">
        <span className="off-ws-readonly-note">
          <Icon icon={Shield} size="sm" />
          System channel is read-only — actions live on each card
        </span>
      </div>
    </>
  );
}

export function MessengerApp() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const openThread = useUiState((s) => s.openThread);
  const conversations = useWsConversations();
  const employees = useEmployees();
  const projects = useProjects(companyId);
  const systemCards = useWsSystemCards();
  const [query, setQuery] = useState('');

  const list = conversations.data ?? [];
  const activeId = selectedId ?? list[0]?.id ?? null;
  const active = list.find((c) => c.id === activeId) ?? null;
  const thread = useWsThread(active && active.kind !== 'system' ? activeId : null);

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q),
    );
  }, [list, query]);

  const pinned = filtered.filter((c) => c.section !== 'earlier');
  const earlier = filtered.filter((c) => c.section === 'earlier');
  const activeEmployee = active?.employeeId ? (byId.get(active.employeeId) ?? null) : null;
  const activeProject = projects.data?.find((p) => p.id === projectId) ?? null;
  const workspaceBound = Boolean(activeProject?.workspaceRoot);
  const baseMessages = thread.data?.messages ?? [];

  const isSystem = active?.kind === 'system';
  const isDirect = active?.kind === 'direct' || active?.kind === 'external';
  let detailBody: ReactNode;
  if (!active) {
    detailBody = (
      <EmptyState
        icon={MessageSquare}
        title="Select a chat"
        description="Pick a conversation from the list."
      />
    );
  } else if (isSystem) {
    detailBody = (
      <SystemChannel cards={systemCards.data ?? []} onOpenActivity={() => setSurface('activity')} />
    );
  } else {
    detailBody = (
      <>
        <header className="off-ws-chat-head">
          <ConvAvatar conv={active} employee={activeEmployee} size={30} />
          <div className="off-ws-crumb">
            <span className="off-ws-crumb-title">{active.title}</span>
            <span className="off-ws-crumb-sub">
              {active.kind === 'group'
                ? active.snippet.trim() || 'Team conversation'
                : `Direct · ${activeEmployee?.role ?? '—'}`}
            </span>
          </div>
          <div className="off-ws-chat-tools">
            <IconButton
              icon={Building2}
              label="Open in Office"
              variant="ghost"
              size="iconSm"
              onClick={() => {
                openThread(active.id);
                setSurface('office');
              }}
            />
            {isDirect ? (
              <IconButton
                icon={Eye}
                label="View in Personnel"
                variant="ghost"
                size="iconSm"
                onClick={() => {
                  if (active.employeeId) selectEmployee(active.employeeId);
                  setSurface('personnel');
                }}
              />
            ) : null}
          </div>
        </header>

        <WorkspaceAssistantThread
          key={active.id}
          active={active}
          messages={baseMessages}
          byId={byId}
          projectId={projectId}
          companyId={companyId}
          workspaceBound={workspaceBound}
        />
      </>
    );
  }

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Chats</span>
        </div>
        <div className="off-ws-list-search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search people, groups, messages"
          />
        </div>
        <div className="off-ws-chats">
          {conversations.isError && list.length === 0 ? (
            <ErrorState
              title="Couldn't load chats"
              detail={errorDetail(conversations.error, 'Your conversations failed to load.')}
              onRetry={() => void conversations.refetch()}
            />
          ) : null}
          {pinned.map((conv) => (
            <ConvRow
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              employee={conv.employeeId ? (byId.get(conv.employeeId) ?? null) : null}
              onSelect={() => selectItem(conv.id)}
            />
          ))}
          {earlier.length > 0 ? (
            <>
              <div className="off-ws-im-sec">Earlier</div>
              {earlier.map((conv) => (
                <ConvRow
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  employee={conv.employeeId ? (byId.get(conv.employeeId) ?? null) : null}
                  onSelect={() => selectItem(conv.id)}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>

      <div className="off-ws-detail">{detailBody}</div>
    </>
  );
}
