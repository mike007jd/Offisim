import { Badge, Button } from '@offisim/ui-core';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { truncate } from '../../lib/format-time';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import type { AgentState, SubTaskInfo } from '../../runtime/use-agent-states';
import type { EmployeeSkillHighlight } from '../../runtime/use-employee-skill-highlights';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

/** Border glow color per state category. */
const STATE_GLOW: Record<string, string> = {
  executing: 'shadow-glow-success',
  success: 'shadow-glow-success',
  failed: 'shadow-glow-error',
  blocked: 'shadow-glow-warning',
};

interface AgentCardProps {
  id: string;
  agent: AgentState;
  isSelected?: boolean;
  skillHighlight?: EmployeeSkillHighlight;
  onClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, skillHighlight, onClick }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-text-muted';
  const glowClass = STATE_GLOW[agent.state] ?? '';
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
      className={[
        'group min-h-20 rounded-lg border px-2.5 py-2 cursor-pointer',
        'transition-colors duration-200',
        isSelected
          ? 'border-border-focus bg-accent-muted'
          : 'border-border-subtle/70 bg-surface-muted/70 hover:border-border-default hover:bg-surface-hover',
        glowing ? glowClass : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center">
          <EmployeeAvatar agent={agent} size={56} className="h-14 w-14 object-cover" />
          <div
            className={`absolute bottom-1 right-0 h-3 w-3 rounded-full border-2 border-surface-elevated transition-colors duration-300 ${dotColor}`}
          />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
              {agent.name}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge
                variant={variant}
                className="min-w-12 justify-center text-caption transition-colors duration-300"
              >
                {agent.state}
              </Badge>
            </div>
          </div>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-text-secondary">
            {roleLabel}
            <Wrench className="inline h-2.5 w-2.5 flex-shrink-0 text-text-muted" />
          </p>
          <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
            <span className="rounded-full border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-caption leading-none text-text-muted">
              {agent.isExternal ? 'External' : 'Internal'}
            </span>
            {skillHighlight ? (
              <span
                className="max-w-36 animate-pulse truncate rounded-full border border-success/30 bg-success-muted px-1.5 py-0.5 text-caption leading-none text-success"
                title={skillHighlight.detail}
              >
                {skillHighlight.label}
              </span>
            ) : null}
            {hasTask && (
              <span className="max-w-32 truncate rounded-full border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-caption leading-none text-text-secondary">
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
    <div className="mt-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between px-0 py-0 text-caption font-mono text-text-muted hover:text-text-secondary"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
      >
        <span>
          {completedCount}/{totalCount} tasks
        </span>
        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </Button>

      <div className="mt-1 flex flex-col gap-0.5">
        {visibleTasks.map((st) => (
          <div key={st.stepIndex} className="flex items-center gap-1 text-caption font-mono">
            <span className="flex-shrink-0">{STATUS_ICON[st.status]}</span>
            <span
              className={[
                'truncate max-w-32',
                st.status === 'done'
                  ? 'text-text-muted'
                  : st.status === 'failed'
                    ? 'text-error'
                    : 'text-text-secondary',
              ].join(' ')}
            >
              {truncate(st.label, 25)}
            </span>
            {st.status === 'running' && st.startedAt && (
              <span className="ml-auto text-text-muted">
                {Math.round((Date.now() - st.startedAt) / 1000)}s
              </span>
            )}
            {st.status === 'done' && <span className="ml-auto text-text-muted">done</span>}
          </div>
        ))}
        {hiddenCount > 0 && !expanded && (
          <div className="pl-4 text-caption font-mono text-text-muted">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
