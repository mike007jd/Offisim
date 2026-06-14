import { useUiState } from '@/app/ui-state.js';
import { displayRole } from '@/data/adapters.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { Building2, MessageSquare, SquarePen, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type ContactDetail,
  type Presence,
  useWsContactDetails,
  useWsConversations,
} from '../workspace-data.js';

const PRESENCE_PILL: Record<Presence, { label: string; cls: string }> = {
  working: { label: 'Working', cls: 'is-working' },
  idle: { label: 'Idle', cls: 'is-idle' },
  blocked: { label: 'Blocked', cls: 'is-blocked' },
  offline: { label: 'Offline', cls: 'is-offline' },
};

const PRESENCE_DOT: Record<Presence, string> = {
  working: 'is-working',
  idle: 'is-idle',
  blocked: 'is-blocked',
  offline: 'is-offline',
};

export function ContactsApp() {
  const employees = useEmployees();
  const details = useWsContactDetails(employees.data ?? []);
  const conversations = useWsConversations();
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const setSurface = useUiState((s) => s.setSurface);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const [query, setQuery] = useState('');

  const detailById = details.data ?? {};
  const list = employees.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q));
  }, [list, query]);

  // Group by the contact's zone; people without a workstation sink to 'Unassigned'.
  const groups = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const e of filtered) {
      const group = detailById[e.id]?.group ?? 'Unassigned';
      const arr = map.get(group) ?? [];
      arr.push(e);
      map.set(group, arr);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b),
    );
  }, [filtered, detailById]);

  const activeId =
    selectedId && filtered.some((e) => e.id === selectedId)
      ? selectedId
      : (filtered[0]?.id ?? null);
  const active = list.find((e) => e.id === activeId) ?? null;
  const activeDetail: ContactDetail | undefined = active ? detailById[active.id] : undefined;
  const presence: Presence = activeDetail?.presence ?? (active?.online ? 'idle' : 'offline');
  const directConversationId = useMemo(() => {
    if (!active) return null;
    return conversations.data?.find((item) => item.employeeId === active.id)?.id ?? null;
  }, [active, conversations.data]);
  const profileSubtitle = active
    ? [displayRole(active), activeDetail ? `${activeDetail.zone.split(' (')[0]} zone` : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head">
          <span className="off-ws-list-title">Contacts</span>
          <button
            type="button"
            className="off-ws-list-add off-focusable"
            title="Hire (opens HR)"
            onClick={() => {
              setSurface('personnel');
            }}
          >
            <Icon icon={UserPlus} size="sm" />
          </button>
        </div>
        <div className="off-ws-list-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or role" />
        </div>
        <div className="off-ws-rows off-ws-ct-rows">
          {employees.isError ? (
            <ErrorState
              title="Couldn't load contacts"
              detail={errorDetail(employees.error, 'The team directory failed to load.')}
              onRetry={() => void employees.refetch()}
            />
          ) : null}
          {groups.map(([group, items]) => (
            <div key={group} className="off-ws-ct-grp-block">
              <div className="off-ws-ct-grp">
                {group}
                <span className="off-ws-ct-grp-ct">{items.length}</span>
              </div>
              {items.map((e) => {
                const p = detailById[e.id]?.presence ?? (e.online ? 'idle' : 'offline');
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={cn('off-ws-ct-row off-focusable', e.id === activeId && 'is-active')}
                    onClick={() => selectItem(e.id)}
                  >
                    <span className="off-ws-ct-av-wrap">
                      <EmployeeAvatar
                        seed={e.id}
                        appearance={e.appearance}
                        colorA={e.avatarA}
                        colorB={e.avatarB}
                        size={34}
                        brand={e.kind === 'external'}
                        className={cn(e.kind === 'external' && 'is-ext')}
                      />
                      <span className={cn('off-ws-pres is-sm', PRESENCE_DOT[p])} />
                    </span>
                    <span className="off-ws-row-copy">
                      <span className="off-ws-ct-nm">{e.name}</span>
                      {displayRole(e) ? <span className="off-ws-ct-role">{e.role}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="off-ws-detail off-ws-ct-detail">
        {active ? (
          <div className="off-ws-ct-pad">
            <div className="off-ws-ct-prof">
              <EmployeeAvatar
                seed={active.id}
                appearance={active.appearance}
                colorA={active.avatarA}
                colorB={active.avatarB}
                size={84}
                brand={active.kind === 'external'}
                className="off-ws-ct-big"
              />
              <div className="off-ws-ct-prof-id">
                <div className="off-ws-ct-prof-nm">{active.name}</div>
                <div className="off-ws-ct-prof-rl">{profileSubtitle}</div>
              </div>
              <span className={cn('off-ws-ct-prof-st', PRESENCE_PILL[presence].cls)}>
                {PRESENCE_PILL[presence].label}
                {activeDetail?.presenceNote ? ` — ${activeDetail.presenceNote}` : ' now'}
              </span>
              <div className="off-ws-ct-cta">
                {directConversationId ? (
                  <button
                    type="button"
                    className="off-ws-oa-approve off-focusable"
                    title={`Open ${active.name}'s direct chat`}
                    onClick={() => {
                      setApp('messenger', directConversationId);
                    }}
                  >
                    <Icon icon={MessageSquare} size="sm" />
                    Direct chat
                  </button>
                ) : (
                  <output className="off-ws-ct-state" aria-label="Direct chat state">
                    <Icon icon={MessageSquare} size="sm" />
                    No chat yet
                  </output>
                )}
                <button
                  type="button"
                  className="off-ws-oa-deny off-focusable"
                  onClick={() => {
                    selectEmployee(active.id);
                    setSurface('office');
                  }}
                >
                  <Icon icon={Building2} size="sm" />
                  Find in Office
                </button>
                <button
                  type="button"
                  className="off-ws-oa-deny off-focusable"
                  onClick={() => {
                    selectEmployee(active.id);
                    setSurface('personnel');
                  }}
                >
                  <Icon icon={SquarePen} size="sm" />
                  Edit in Personnel
                </button>
              </div>
            </div>

            <dl className="off-ws-ct-kv">
              <div className="off-ws-ct-kv-row">
                <dt>Role</dt>
                <dd>{active.role}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Zone</dt>
                <dd>{activeDetail?.zone ?? active.zoneLabel ?? '—'}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Model</dt>
                <dd>{activeDetail?.model ?? active.modelLabel}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Expertise</dt>
                <dd>{activeDetail?.expertise ?? active.expertise?.join(' · ') ?? '—'}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Tools</dt>
                <dd>
                  {activeDetail?.tools ?? '—'}
                  {activeDetail?.toolsNote ? (
                    <span className="off-ws-ct-kv-note"> {activeDetail.toolsNote}</span>
                  ) : null}
                </dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Decision style</dt>
                <dd>{activeDetail?.decisionStyle ?? '—'}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Open chats</dt>
                <dd>{activeDetail?.openChats ?? '—'}</dd>
              </div>
              <div className="off-ws-ct-kv-row">
                <dt>Source</dt>
                <dd>
                  {activeDetail?.source ??
                    (active.kind === 'external' ? 'External (A2A)' : 'Internal employee')}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No contact"
            description="Pick someone to view their profile."
          />
        )}
      </div>
    </>
  );
}
