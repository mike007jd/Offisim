import { type AgentState, DicebearAvatar } from '@offisim/ui-office/web';
import { Plus } from 'lucide-react';
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
} from './StageRunSurfaces';

interface StageTeamDockProps {
  agents: Map<string, AgentState>;
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
  onOpenCreator: () => void;
}

type StageTeamStatus =
  | 'assigned'
  | 'blocked'
  | 'executing'
  | 'failed'
  | 'idle'
  | 'meeting'
  | 'thinking'
  | 'waiting';

function stageTeamStatus(state: string): StageTeamStatus {
  if (
    state === 'assigned' ||
    state === 'blocked' ||
    state === 'executing' ||
    state === 'failed' ||
    state === 'meeting' ||
    state === 'thinking' ||
    state === 'waiting'
  ) {
    return state;
  }
  return 'idle';
}

/**
 * Horizontal Team dock below the stage — relocation home of the displaced
 * left-rail employee roster (`AgentPanel`). Each employee is an avatar + name +
 * status dot; selecting one anchors the existing employee inspector / Personnel
 * routing. The strip ends with an `Add` slot that opens employee creation.
 * In-scene avatars (scene canvas) carry the same roster on the stage itself.
 */
export function StageTeamDock({
  agents,
  selectedEmployeeId,
  onSelectEmployee,
  onOpenCreator,
}: StageTeamDockProps) {
  const entries = [...agents.entries()];

  return (
    <StageTeamDockShell aria-label="Team dock">
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
              <StageTeamEmployeeName>{agent.name}</StageTeamEmployeeName>
              <StageTeamStatusDot state={stageTeamStatus(agent.state)} />
            </StageTeamEmployeeButton>
          );
        })}
        <StageTeamAddButton type="button" onClick={onOpenCreator} title="Add employee">
          <Plus data-icon="inline-start" aria-hidden="true" />
          <StageTeamAddLabel>Add</StageTeamAddLabel>
        </StageTeamAddButton>
      </StageTeamRoster>
    </StageTeamDockShell>
  );
}
