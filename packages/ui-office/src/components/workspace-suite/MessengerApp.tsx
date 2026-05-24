import type { ProjectRow } from '@offisim/shared-types';
import { Button, Input } from '@offisim/ui-core';
import { Building2, Search, Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
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
  const searchInputId = useId();
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
    <div className="messenger-app">
      {/* Conversation list */}
      <div className="messenger-list">
        <div className="messenger-list-head">
          <span>Chats</span>
          <label htmlFor={searchInputId} className="messenger-search">
            <Search data-icon="search" aria-hidden="true" />
            <Input
              id={searchInputId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, groups, messages"
              className="messenger-search-input"
            />
          </label>
        </div>

        <div className="messenger-list-scroll">
          {!projectId ? (
            <p className="messenger-list-empty">Select a project to see its conversations.</p>
          ) : (
            <>
              {filteredTeams.map((team) => {
                const isActive = selection === 'team' && team.threadId === activeThreadId;
                return (
                  <ConversationRow
                    key={team.threadId}
                    active={isActive}
                    avatar={
                      <span className="messenger-avatar messenger-avatar-team">
                        <Building2 data-icon="avatar" aria-hidden="true" />
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
                  <span className="messenger-avatar messenger-avatar-system">
                    <Sparkles data-icon="avatar" aria-hidden="true" />
                  </span>
                }
                name="System"
                badge="bot"
                snippet="Runtime · HR · Market · Install notifications"
                onClick={() => setSystemOpen(true)}
              />

              {filteredDirect.length > 0 ? (
                <div className="messenger-list-section">Direct</div>
              ) : null}
              {filteredDirect.map(({ id, agent }) => {
                const isActive = selection === 'direct' && id === selectedEmployeeId;
                return (
                  <ConversationRow
                    key={id}
                    active={isActive}
                    avatar={
                      <div className="messenger-avatar messenger-avatar-direct">
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
      <div className="messenger-detail">
        {selection === 'system' ? (
          <SystemChannel onFocusEmployee={onFocusEmployee} onOpenActivityLog={onOpenActivityLog} />
        ) : !projectId ? (
          <div className="messenger-detail-empty">
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
      className="messenger-conversation-row"
      data-active={active || undefined}
    >
      {avatar}
      <span className="messenger-conversation-copy">
        <span className="messenger-conversation-title-row">
          <span className="messenger-conversation-title">{name}</span>
          {badge ? <span className="messenger-conversation-badge">{badge}</span> : null}
        </span>
        <span className="messenger-conversation-snippet">{snippet}</span>
      </span>
    </Button>
  );
}

export { SYSTEM_CHANNEL };
