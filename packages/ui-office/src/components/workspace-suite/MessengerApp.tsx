import type { ProjectRow } from '@offisim/shared-types';
import { Button, Input, cn } from '@offisim/ui-core';
import { Building2, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ChatPanel } from '../chat/ChatPanel';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';
import { SystemChannel } from './SystemChannel';
import { useMessengerConversations } from './useMessengerConversations';

/** Synthetic selection for the read-only System notifications channel. */
const SYSTEM_CHANNEL = 'system';

export interface MessengerAppProps {
  activeProject: ProjectRow | null;
  activeThreadId: string | null;
  selectedEmployeeId: string | null;
  onSelectThread: (threadId: string) => void;
  onSelectEmployee: (employeeId: string | null) => void;
  onOpenSettings: () => void;
  onFocusEmployee?: (employeeId: string) => void;
  onOpenActivityLog?: () => void;
}

type Selection = 'team' | 'direct' | 'system';

export function MessengerApp(props: MessengerAppProps) {
  const {
    activeProject,
    activeThreadId,
    selectedEmployeeId,
    onSelectThread,
    onSelectEmployee,
    onOpenSettings,
    onFocusEmployee,
    onOpenActivityLog,
  } = props;

  const projectId = activeProject?.project_id ?? null;
  const { teams } = useMessengerConversations(projectId);
  const agents = useAgentStates();
  const [search, setSearch] = useState('');
  const [systemOpen, setSystemOpen] = useState(false);

  const directEmployees = useMemo(
    () => Array.from(agents.entries()).map(([id, agent]) => ({ id, agent })),
    [agents],
  );

  const query = search.trim().toLowerCase();
  const filteredTeams = useMemo(
    () => (query ? teams.filter((t) => t.title.toLowerCase().includes(query)) : teams),
    [teams, query],
  );
  const filteredDirect = useMemo(
    () =>
      query
        ? directEmployees.filter(({ agent }) => agent.name.toLowerCase().includes(query))
        : directEmployees,
    [directEmployees, query],
  );

  // Selection model: the System channel is suite-local (read-only feed).
  // Team vs Direct is derived from the Office SSOT (selectedEmployeeId set =
  // direct chat, else the active team thread).
  const selection: Selection = systemOpen ? 'system' : selectedEmployeeId ? 'direct' : 'team';

  const handleSelectTeam = (threadId: string) => {
    setSystemOpen(false);
    onSelectEmployee(null);
    onSelectThread(threadId);
  };

  const handleSelectDirect = (employeeId: string) => {
    setSystemOpen(false);
    onSelectEmployee(employeeId);
  };

  const selectedEmployeeName = selectedEmployeeId
    ? (agents.get(selectedEmployeeId)?.name ?? null)
    : null;

  return (
    <div className="flex h-full min-h-0 min-w-0">
      {/* Conversation list */}
      <div className="flex w-80 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex flex-col gap-2 border-b border-line-soft px-3 pb-2 pt-2.5">
          <span className="text-fs-md font-bold text-ink-1">Chats</span>
          <label className="flex h-8 items-center gap-2 rounded-r-sm border border-line bg-surface-sunken px-2.5 text-fs-sm text-ink-4 transition-colors focus-within:border-line-strong">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, groups, messages"
              className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-fs-sm text-ink-1 shadow-none outline-none placeholder:text-ink-4 focus-visible:ring-0"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-2">
          {!projectId ? (
            <p className="px-2 py-6 text-center text-fs-meta text-ink-4">
              Select a project to see its conversations.
            </p>
          ) : (
            <>
              {filteredTeams.map((team) => {
                const isActive = selection === 'team' && team.threadId === activeThreadId;
                return (
                  <ConversationRow
                    key={team.threadId}
                    active={isActive}
                    avatar={
                      <span className="grid size-10 place-items-center rounded-r-md bg-accent-surface text-accent ring-1 ring-line">
                        <Building2 className="size-3.5" aria-hidden="true" />
                      </span>
                    }
                    name={team.title}
                    snippet={team.summary ?? 'Team thread'}
                    onClick={() => handleSelectTeam(team.threadId)}
                  />
                );
              })}

              <ConversationRow
                active={selection === 'system'}
                avatar={
                  <span className="grid size-10 place-items-center rounded-r-md bg-violet-surface text-violet ring-1 ring-line">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                  </span>
                }
                name="System"
                badge="bot"
                snippet="Runtime · HR · Market · Install notifications"
                onClick={() => setSystemOpen(true)}
              />

              {filteredDirect.length > 0 ? (
                <div className="px-2 pb-1 pt-3 text-fs-micro font-bold uppercase tracking-widest text-ink-4">
                  Direct
                </div>
              ) : null}
              {filteredDirect.map(({ id, agent }) => {
                const isActive = selection === 'direct' && id === selectedEmployeeId;
                return (
                  <ConversationRow
                    key={id}
                    active={isActive}
                    avatar={
                      <div className="size-10 overflow-hidden rounded-r-md ring-1 ring-line">
                        <EmployeeAvatar agent={agent} size={40} />
                      </div>
                    }
                    name={agent.name}
                    badge={agent.isExternal ? 'ext' : undefined}
                    snippet={agent.role}
                    onClick={() => handleSelectDirect(id)}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="grid min-h-0 min-w-0 flex-1">
        {selection === 'system' ? (
          <SystemChannel onFocusEmployee={onFocusEmployee} onOpenActivityLog={onOpenActivityLog} />
        ) : !projectId ? (
          <div className="grid h-full place-items-center px-6 text-center text-fs-sm text-ink-4">
            No project selected. Pick a project to open its team conversation.
          </div>
        ) : (
          <ChatPanel
            onOpenSettings={onOpenSettings}
            selectedEmployeeId={selectedEmployeeId}
            selectedEmployeeName={selectedEmployeeName}
            onClearSelection={() => onSelectEmployee(null)}
            activeProject={activeProject}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
            showPipelineProgress={false}
            showMeetingPanel={false}
            showActivityRail
          />
        )}
      </div>
    </div>
  );
}

interface ConversationRowProps {
  active: boolean;
  avatar: React.ReactNode;
  name: string;
  badge?: 'bot' | 'ext';
  snippet: string;
  onClick: () => void;
}

function ConversationRow({ active, avatar, name, badge, snippet, onClick }: ConversationRowProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-auto w-full items-center justify-start gap-2 rounded-r-md border border-transparent px-2 py-2 text-left transition-colors',
        active ? 'border-accent-ring bg-accent-surface' : 'hover:bg-surface-sunken',
      )}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-fs-sm font-semibold',
              active ? 'text-accent' : 'text-ink-1',
            )}
          >
            {name}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-r-xs bg-violet-surface px-1.5 py-px text-fs-micro font-bold uppercase tracking-wide text-violet">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-fs-meta text-ink-3">{snippet}</span>
      </span>
    </Button>
  );
}

export { SYSTEM_CHANNEL };
