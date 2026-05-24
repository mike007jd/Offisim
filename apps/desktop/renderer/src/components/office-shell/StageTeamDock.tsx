import { type AgentState, DicebearAvatar, agentStatusTone } from '@offisim/ui-office/web';
import { ChevronDown, ChevronUp, Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import {
  StageTeamAddButton,
  StageTeamAddLabel,
  StageTeamAvatarSlot,
  StageTeamCountBadge,
  StageTeamDockShell,
  StageTeamEmployeeButton,
  StageTeamEmployeeName,
  StageTeamLabel,
  StageTeamRoster,
  StageTeamStatusDot,
  StageTeamSummary,
  StageTeamToolButton,
  StageTeamTools,
} from './StageShellSurfaces';

interface StageTeamDockProps {
  agents: Map<string, AgentState>;
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
  onOpenCreator: () => void;
  onOpenPersonnel: () => void;
}

/**
 * Horizontal Team dock below the stage. Each employee is an avatar + name +
 * status dot; selecting one anchors the Personnel route. The strip ends with an
 * `Add` slot that opens employee creation.
 * In-scene avatars (scene canvas) carry the same roster on the stage itself.
 */
export function StageTeamDock({
  agents,
  selectedEmployeeId,
  onSelectEmployee,
  onOpenCreator,
  onOpenPersonnel,
}: StageTeamDockProps) {
  const entries = [...agents.entries()];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <StageTeamDockShell aria-label="Team dock" data-collapsed={collapsed ? 'true' : 'false'}>
      <StageTeamSummary>
        <StageTeamLabel>Team</StageTeamLabel>
        <StageTeamCountBadge>
          {entries.length} {entries.length === 1 ? 'person' : 'people'}
        </StageTeamCountBadge>
      </StageTeamSummary>

      <StageTeamRoster>
        {entries.map(([id, agent]) => {
          const selected = selectedEmployeeId === id;
          return (
            <StageTeamEmployeeButton
              type="button"
              key={id}
              onClick={() => onSelectEmployee(id)}
              aria-pressed={selected}
              title={`${agent.name} · ${agent.role}`}
              state={selected ? 'selected' : 'idle'}
            >
              <StageTeamAvatarSlot>
                <DicebearAvatar seed={agent.avatarSeed} appearance={agent.appearance} size={46} />
              </StageTeamAvatarSlot>
              <StageTeamStatusDot state={agentStatusTone(agent.state)} />
              <StageTeamEmployeeName>{agent.name}</StageTeamEmployeeName>
            </StageTeamEmployeeButton>
          );
        })}
        <StageTeamAddButton type="button" onClick={onOpenCreator} title="Add employee">
          <Plus data-icon="inline-start" aria-hidden="true" />
          <StageTeamAddLabel>Add</StageTeamAddLabel>
        </StageTeamAddButton>
      </StageTeamRoster>

      <StageTeamTools>
        <StageTeamToolButton
          type="button"
          aria-label="Open personnel directory"
          title="Open personnel directory"
          onClick={onOpenPersonnel}
        >
          <UsersRound data-icon="inline-start" aria-hidden="true" />
        </StageTeamToolButton>
        <StageTeamToolButton
          type="button"
          aria-label={collapsed ? 'Expand team dock' : 'Collapse team dock'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand team dock' : 'Collapse team dock'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? (
            <ChevronUp data-icon="inline-start" aria-hidden="true" />
          ) : (
            <ChevronDown data-icon="inline-start" aria-hidden="true" />
          )}
        </StageTeamToolButton>
      </StageTeamTools>
    </StageTeamDockShell>
  );
}
