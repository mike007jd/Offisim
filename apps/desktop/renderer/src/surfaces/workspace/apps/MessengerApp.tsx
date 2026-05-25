import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  AlertTriangle,
  AtSign,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Layers,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  SendHorizontal,
  Shield,
  Sparkles,
  Store,
  Terminal,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  MODE_LABEL,
  type SysCard,
  type SysLevel,
  type SysSource,
  type WsConversation,
  type WsMessage,
  type WsRunRecord,
  useWsConversations,
  useWsSystemCards,
  useWsThread,
} from '../workspace-data.js';

type ConvFacet = 'chat' | 'files' | 'docs';

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
  if (conv.kind === 'group') {
    return (
      <span className="off-ws-im-av is-group" style={{ width: size, height: size }}>
        <Icon icon={conv.id === 'th-design' ? Users : Building2} size="sm" />
      </span>
    );
  }
  if (conv.kind === 'system') {
    return (
      <span className="off-ws-im-av is-bot" style={{ width: size, height: size }}>
        <Icon icon={Sparkles} size="sm" />
      </span>
    );
  }
  if (employee) {
    return (
      <span className="off-ws-im-av-wrap">
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
    <span className="off-ws-im-av is-group" style={{ width: size, height: size }}>
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

function ReasoningTag() {
  return (
    <span className="off-ws-reasoning">
      <Icon icon={ChevronRight} size="sm" />
      Reasoning
    </span>
  );
}

function DeliverableInline({
  card,
  byId,
  onExport,
}: {
  card: NonNullable<WsMessage['deliverable']>;
  byId: Map<string, Employee>;
  onExport: () => void;
}) {
  return (
    <div className="off-ws-dlv">
      <div className="off-ws-dlv-head">
        <Icon icon={FileText} size="sm" className="off-ws-dlv-ico" />
        <div className="off-ws-dlv-main">
          <div className="off-ws-dlv-titlerow">
            <span className="off-ws-dlv-title">{card.title}</span>
            <span className="off-ws-dlv-meta">{card.meta}</span>
          </div>
          <div className="off-ws-dlv-stack">
            {card.contributorIds.map((id) => {
              const e = byId.get(id);
              if (!e) return null;
              return (
                <EmployeeAvatar
                  key={id}
                  seed={e.id}
                  appearance={e.appearance}
                  colorA={e.avatarA}
                  colorB={e.avatarB}
                  size={20}
                  brand={e.kind === 'external'}
                  className="off-ws-dlv-av"
                />
              );
            })}
          </div>
        </div>
      </div>
      <div className="off-ws-dlv-actions">
        <button type="button" className="off-ws-dlv-btn off-focusable" onClick={onExport}>
          Open
        </button>
        <span className="off-ws-dlv-fmt">
          {card.format}
          <Icon icon={ChevronDown} size="sm" />
        </span>
        <button type="button" className="off-ws-dlv-btn off-focusable" onClick={onExport}>
          Export
        </button>
      </div>
    </div>
  );
}

function RunRecordInline({ run }: { run: WsRunRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('off-ws-run', open && 'is-open')}>
      <button
        type="button"
        className="off-ws-run-head off-focusable"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={Terminal} size="sm" className="off-ws-run-ico" />
        <span className="off-ws-run-title">Run record</span>
        <span className="off-ws-run-meta">{run.meta}</span>
        <span className="off-ws-run-cost">{run.costLabel}</span>
        <Icon icon={ChevronRight} size="sm" className="off-ws-run-caret" />
      </button>
      {open && run.activity.length > 0 ? (
        <div className="off-ws-run-body">
          <div className="off-ws-run-sec-head">Activity</div>
          <div className="off-ws-act-entries">
            {run.activity.map((entry) => (
              <div key={entry.id} className={cn('off-ws-act-entry', `is-${entry.level}`)}>
                <Icon icon={entry.level === 'warning' ? AlertTriangle : Terminal} size="sm" />
                <span>{entry.detail}</span>
                {entry.repeat && entry.repeat > 1 ? (
                  <span className="off-ws-act-x">×{entry.repeat}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageRow({
  message,
  byId,
  onExport,
}: {
  message: WsMessage;
  byId: Map<string, Employee>;
  onExport: () => void;
}) {
  const employee = message.employeeId ? byId.get(message.employeeId) : null;
  const isMe = message.author === 'boss';
  return (
    <div className={cn('off-ws-msg-row', isMe && 'is-me')}>
      <div className="off-ws-msg-from">
        {isMe ? (
          <EmployeeAvatar seed="Boss" colorA="#d7e3ff" colorB="#aac4ff" size={22} />
        ) : employee ? (
          <EmployeeAvatar
            seed={employee.id}
            appearance={employee.appearance}
            colorA={employee.avatarA}
            colorB={employee.avatarB}
            size={22}
            brand={employee.kind === 'external'}
          />
        ) : null}
        <span className="off-ws-msg-nm">{isMe ? 'You' : (employee?.name ?? 'Employee')}</span>
        {message.role ? <span className="off-ws-msg-rl">{message.role}</span> : null}
        <span className="off-ws-msg-tm">{message.timeLabel}</span>
      </div>
      {message.reasoning ? <ReasoningTag /> : null}
      <div className={cn('off-ws-bubble', isMe && 'is-me')}>{message.body}</div>
      {message.attachment ? (
        <div className="off-ws-attachment">
          <span className="off-ws-file-icon">
            <Icon icon={FileText} size="sm" />
          </span>
          <span>
            <span className="off-ws-fname">{message.attachment.name}</span>
            <span className="off-ws-fmeta">{message.attachment.meta}</span>
          </span>
          <span className="off-ws-download">
            <Icon icon={Download} size="sm" />
          </span>
        </div>
      ) : null}
      {message.deliverable ? (
        <DeliverableInline card={message.deliverable} byId={byId} onExport={onExport} />
      ) : null}
    </div>
  );
}

function SystemChannel({ cards }: { cards: SysCard[] }) {
  return (
    <>
      <header className="off-ws-chat-head">
        <span className="off-ws-ch-av is-bot">
          <Icon icon={Sparkles} size="sm" />
        </span>
        <div className="off-ws-crumb">
          <span className="off-ws-crumb-title">System</span>
          <span className="off-ws-crumb-sub">Notifications · runtime · hr · market · install</span>
        </div>
        <div className="off-ws-chat-tools">
          <IconButton icon={Check} label="Mark all read" variant="ghost" size="iconSm" />
          <IconButton icon={Terminal} label="Open Activity Log" variant="ghost" size="iconSm" />
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
                        <button
                          key={action.id}
                          type="button"
                          className={cn(
                            'off-ws-sys-btn off-focusable',
                            action.primary && 'is-primary',
                          )}
                          onClick={() => toast.message(action.label)}
                        >
                          {action.label}
                        </button>
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

function ConvTabs({
  conv,
  facet,
  onFacet,
}: {
  conv: WsConversation;
  facet: ConvFacet;
  onFacet: (f: ConvFacet) => void;
}) {
  const tabs: Array<{ key: ConvFacet; label: string; icon: typeof MessageSquare; count?: number }> =
    [
      { key: 'chat', label: 'Chat', icon: MessageSquare },
      { key: 'files', label: 'Files', icon: Paperclip, count: conv.fileCount },
      { key: 'docs', label: 'Docs', icon: Layers, count: conv.docCount },
    ];
  return (
    <div className="off-ws-conv-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={cn('off-ws-conv-tab off-focusable', facet === t.key && 'is-active')}
          onClick={() => onFacet(t.key)}
        >
          <Icon icon={t.icon} size="sm" />
          {t.label}
          {t.count ? <span className="off-ws-conv-ct">{t.count}</span> : null}
        </button>
      ))}
      <IconButton
        icon={Plus}
        label="Pin a doc or board"
        variant="ghost"
        size="iconSm"
        className="off-ws-conv-tab-add"
      />
    </div>
  );
}

function FacetEmpty({ kind }: { kind: 'files' | 'docs' }) {
  return (
    <EmptyState
      icon={kind === 'files' ? Paperclip : Layers}
      title={kind === 'files' ? 'No files yet' : 'No docs yet'}
      description={
        kind === 'files'
          ? 'Files shared in this conversation appear here.'
          : 'Deliverables produced in this thread land here.'
      }
    />
  );
}

export function MessengerApp() {
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const conversations = useWsConversations();
  const employees = useEmployees();
  const systemCards = useWsSystemCards();
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState<ConvFacet>('chat');
  const [draft, setDraft] = useState('');
  const [sentByConv, setSentByConv] = useState<Record<string, WsMessage[]>>({});

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
  const sentDrafts = activeId ? (sentByConv[activeId] ?? []) : [];
  const baseMessages = thread.data?.messages ?? [];
  const allMessages = useMemo(() => [...baseMessages, ...sentDrafts], [baseMessages, sentDrafts]);

  function send() {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSentByConv((prev) => ({
      ...prev,
      [activeId]: [
        ...(prev[activeId] ?? []),
        {
          id: `ws-d-${Date.now()}`,
          author: 'boss',
          employeeId: null,
          timeLabel: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(
            Date.now(),
          ),
          body: text,
        },
      ],
    }));
    setDraft('');
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isSystem = active?.kind === 'system';
  const isDirect = active?.kind === 'direct' || active?.kind === 'external';
  const mode = active?.mode ?? 'sop';
  const modeClass = `is-${mode}`;

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
    detailBody = <SystemChannel cards={systemCards.data ?? []} />;
  } else {
    detailBody = (
      <>
        <header className="off-ws-chat-head">
          <ConvAvatar conv={active} employee={activeEmployee} size={30} />
          <div className="off-ws-crumb">
            <span className="off-ws-crumb-title">{active.title}</span>
            <span className="off-ws-crumb-sub">
              {active.kind === 'group'
                ? `Team thread · ${active.members ?? 0} members · ${active.workingNow ?? 0} working now`
                : `Direct · ${activeEmployee?.role ?? '—'} · ${
                    active.presence === 'working' ? 'Working now' : (active.presence ?? 'idle')
                  }`}
            </span>
          </div>
          <div className="off-ws-chat-tools">
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
            <IconButton
              icon={Search}
              label="Search in conversation"
              variant="ghost"
              size="iconSm"
            />
            {!isDirect ? (
              <IconButton icon={Video} label="Start a meeting" variant="ghost" size="iconSm" />
            ) : null}
            {!isDirect ? (
              <IconButton icon={Users} label="Members" variant="ghost" size="iconSm" />
            ) : null}
            <IconButton icon={MoreHorizontal} label="More" variant="ghost" size="iconSm" />
          </div>
        </header>

        <ConvTabs conv={active} facet={facet} onFacet={setFacet} />

        <div className="off-ws-conv-scroll">
          {facet === 'chat' ? (
            allMessages.length === 0 ? (
              <EmptyState
                icon={MessageSquarePlus}
                title="No messages"
                description="Send the first message to start."
              />
            ) : (
              <>
                <section className="off-ws-messages">
                  <span className="off-ws-day-sep">{thread.data?.daySep ?? 'Today'}</span>
                  {allMessages.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      byId={byId}
                      onExport={() => toast.success('Export started')}
                    />
                  ))}
                </section>
                {thread.data?.run ? <RunRecordInline run={thread.data.run} /> : null}
              </>
            )
          ) : (
            <div className="off-ws-facet-pad">
              <FacetEmpty kind={facet} />
            </div>
          )}
        </div>

        <div className="off-ws-composer">
          <textarea
            className="off-ws-composer-input"
            placeholder={`Message ${active.title}…`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="off-ws-composer-tools">
            <IconButton icon={Paperclip} label="Attach file" variant="subtle" size="iconSm" />
            <IconButton icon={AtSign} label="Mention" variant="subtle" size="iconSm" />
            <span className="off-ws-comp-div" />
            <button type="button" className="off-ws-comp-pill is-model off-focusable">
              <Icon icon={Sparkles} size="sm" />
              MiniMax · M2.7 · Med
              <Icon icon={ChevronDown} size="sm" className="off-ws-comp-caret" />
            </button>
            <button type="button" className={cn('off-ws-comp-pill is-mode', modeClass)}>
              <span className="off-ws-mode-dot" />
              {MODE_LABEL[mode]}
              <Icon icon={ChevronDown} size="sm" className="off-ws-comp-caret" />
            </button>
            <span className="off-grow" />
            <button
              type="button"
              className="off-ws-send off-focusable"
              disabled={!draft.trim()}
              onClick={send}
            >
              Send
              <Icon icon={SendHorizontal} size="sm" />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Chats</span>
          <IconButton icon={UserPlus} label="New chat / group" variant="subtle" size="iconSm" />
        </div>
        <div className="off-ws-list-search">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search people, groups, messages"
          />
        </div>
        <div className="off-ws-chats">
          {pinned.map((conv) => (
            <ConvRow
              key={conv.id}
              conv={conv}
              active={conv.id === activeId}
              employee={conv.employeeId ? (byId.get(conv.employeeId) ?? null) : null}
              onSelect={() => {
                selectItem(conv.id);
                setFacet('chat');
              }}
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
                  onSelect={() => {
                    selectItem(conv.id);
                    setFacet('chat');
                  }}
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
