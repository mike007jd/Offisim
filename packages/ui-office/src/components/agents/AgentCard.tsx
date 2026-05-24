import { Badge, Button } from '@offisim/ui-core';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { truncate } from '../../lib/format-time';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS } from '../../lib/state-variants';
import type { AgentState, SubTaskInfo } from '../../runtime/use-agent-states';
import type { EmployeeSkillHighlight } from '../../runtime/use-employee-skill-highlights';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

interface AgentCardProps {
  id: string;
  agent: AgentState;
  isSelected?: boolean;
  skillHighlight?: EmployeeSkillHighlight;
  onClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, skillHighlight, onClick }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const isInteractive = Boolean(onClick);

  // Track state changes for border glow animation
  const prevStateRef = useRef(agent.state);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    if (prevStateRef.current !== agent.state) {
      prevStateRef.current = agent.state;
      setGlowing(true);
      const timer = setTimeout(() => setGlowing(false), 500);
      return () => clearTimeout(timer);
    }
  }, [agent.state]);

  const task = agent.currentTask;
  const hasTask = task && task.totalSteps > 0;
  const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;

  return (
    <div
      data-testid={`agent-card-${id}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `${agent.name} employee card` : undefined}
      aria-pressed={isInteractive ? (isSelected ?? false) : undefined}
      className="agent-card"
      data-selected={isSelected ? 'true' : 'false'}
      data-glowing={glowing ? 'true' : 'false'}
      data-state={agent.state}
      data-interactive={isInteractive ? 'true' : 'false'}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="agent-card-main">
        <div className="agent-card-avatar">
          <EmployeeAvatar agent={agent} size={56} className="agent-card-avatar-image" />
          <div data-slot="status-dot" />
        </div>

        {/* Info */}
        <div className="agent-card-copy">
          <div className="agent-card-title">
            <span>{agent.name}</span>
            <div>
              <Badge variant={variant} className="agent-card-state">
                {agent.state}
              </Badge>
            </div>
          </div>
          <p className="agent-card-role">
            {roleLabel}
            <Wrench data-icon="role-tool" aria-hidden="true" />
          </p>
          <div className="agent-card-tags">
            <span>{agent.isExternal ? 'External' : 'Internal'}</span>
            {skillHighlight ? (
              <span data-state="highlight" title={skillHighlight.detail}>
                {skillHighlight.label}
              </span>
            ) : null}
            {hasTask && (
              <span data-state="task">
                {task.stepIndex + 1}/{task.totalSteps} {truncate(task.stepLabel, 18)}
              </span>
            )}
          </div>
        </div>
      </div>

      <SubTaskList subTasks={agent.subTasks} />
    </div>
  );
}

const STATUS_ICON: Record<SubTaskInfo['status'], string> = {
  done: 'done',
  running: 'run',
  queued: 'wait',
  failed: 'fail',
};

function SubTaskList({ subTasks }: { subTasks?: SubTaskInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  // Tick every second to update running task elapsed time
  const [, setTick] = useState(0);
  const hasRunning = subTasks?.some((s) => s.status === 'running') ?? false;
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  if (!subTasks || subTasks.length <= 1) return null;

  const completedCount = subTasks.filter((s) => s.status === 'done').length;
  const totalCount = subTasks.length;
  const visibleTasks = expanded ? subTasks : subTasks.slice(0, 4);
  const hiddenCount = subTasks.length - visibleTasks.length;

  return (
    <div className="subtask-list">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="subtask-list-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
      >
        <span>
          {completedCount}/{totalCount} tasks
        </span>
        {expanded ? (
          <ChevronUp data-icon="inline-end" aria-hidden="true" />
        ) : (
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        )}
      </Button>

      <div className="subtask-list-items">
        {visibleTasks.map((st) => (
          <div key={st.stepIndex} className="subtask-list-item" data-status={st.status}>
            <span data-slot="status">{STATUS_ICON[st.status]}</span>
            <span data-slot="label">{truncate(st.label, 25)}</span>
            {st.status === 'running' && st.startedAt && (
              <span data-slot="time">{Math.round((Date.now() - st.startedAt) / 1000)}s</span>
            )}
            {st.status === 'done' && <span data-slot="time">done</span>}
          </div>
        ))}
        {hiddenCount > 0 && !expanded && (
          <div className="subtask-list-more">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
