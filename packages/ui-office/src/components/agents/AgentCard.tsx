import { Badge } from '@offisim/ui-core';
import { Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { truncate } from '../../lib/format-time';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import type { AgentState } from '../../runtime/use-agent-states';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

// Inject @keyframes once at module level (not per card instance)
if (typeof document !== 'undefined' && !document.getElementById('agent-card-keyframes')) {
  const style = document.createElement('style');
  style.id = 'agent-card-keyframes';
  style.textContent =
    '@keyframes slideInRight { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }';
  document.head.appendChild(style);
}

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
  onClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, onClick }: AgentCardProps) {
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
  const isComplete = agent.state === 'success';
  const isFailed = agent.state === 'failed';

  return (
    <div
      data-testid={`agent-card-${id}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `${agent.name} employee card` : undefined}
      aria-pressed={isInteractive ? (isSelected ?? false) : undefined}
      className={[
        'min-h-[96px] rounded-xl border bg-surface p-3 cursor-pointer',
        'transition-all duration-300',
        isSelected
          ? 'border-border-focus bg-accent-muted shadow-glow-accent'
          : 'border-border-default hover:border-border-focus hover:bg-surface-hover hover:shadow-glow-accent',
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
      <div className="flex items-start gap-3">
        {/* Avatar with status dot */}
        <div className="relative flex-shrink-0">
          <div className="h-11 w-11 overflow-hidden rounded-full border border-border-default bg-surface-muted">
            <EmployeeAvatar agent={agent} size={44} className="w-full h-full object-cover" />
          </div>
          <div
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-surface transition-colors duration-300 ${dotColor}`}
          />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
              {agent.name}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge
                variant={variant}
                className="min-w-[46px] justify-center text-[10px] transition-colors duration-300"
              >
                {agent.state}
              </Badge>
            </div>
          </div>
          <p className="flex items-center gap-1 truncate text-xs text-text-secondary">
            {ROLE_LABELS[agent.role] ?? agent.role}
            <Wrench className="inline h-2.5 w-2.5 flex-shrink-0 text-text-muted" />
          </p>
        </div>
      </div>

      {/* ── Task progress bar (slides in from right) ── */}
      {hasTask && (
        <div
          className={[
            'mt-2 flex items-center gap-1.5 text-[10px] font-mono',
            'transform transition-all duration-300',
            isComplete ? 'text-success' : isFailed ? 'text-error' : 'text-text-secondary',
          ].join(' ')}
          style={{
            animation: 'slideInRight 0.3s ease-out',
          }}
        >
          <span>{isComplete ? '✓' : isFailed ? '✗' : '📋'}</span>
          <span>
            {task.stepIndex + 1}/{task.totalSteps}
          </span>
          <span className="max-w-[120px] truncate">{truncate(task.stepLabel, 25)}</span>
        </div>
      )}

      {/* ── Sub-task expandable list ── */}
      <SubTaskList subTasks={agent.subTasks} />
    </div>
  );
}

// ── Sub-task expandable list ────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  done: '✅',
  running: '⚙️',
  queued: '⏳',
  failed: '❌',
};

function SubTaskList({
  subTasks,
}: { subTasks?: import('../../runtime/use-agent-states').SubTaskInfo[] }) {
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
      {/* Summary header — clickable to expand */}
      <button
        type="button"
        className="flex w-full items-center justify-between text-[10px] font-mono text-text-muted transition-colors hover:text-text-secondary"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
      >
        <span>
          📋 {completedCount}/{totalCount} tasks
        </span>
        <span className="text-[8px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Task list */}
      <div className="mt-1 space-y-0.5">
        {visibleTasks.map((st) => (
          <div key={st.stepIndex} className="flex items-center gap-1 text-[10px] font-mono">
            <span className="flex-shrink-0">{STATUS_ICON[st.status] ?? '⏳'}</span>
            <span
              className={[
                'truncate max-w-[130px]',
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
          <div className="pl-4 text-[10px] font-mono text-text-muted">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
