import { Badge } from '@offisim/ui-core';
import { Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { truncate } from '../../lib/format-time';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import type { AgentState } from '../../runtime/use-agent-states';
import { DicebearAvatar } from '../shared/DicebearAvatar';

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
  executing: 'shadow-[0_0_12px_rgba(16,185,129,0.25)]',
  success: 'shadow-[0_0_12px_rgba(34,197,94,0.30)]',
  failed: 'shadow-[0_0_12px_rgba(239,68,68,0.25)]',
  blocked: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]',
};

interface AgentCardProps {
  id: string;
  agent: AgentState;
  isSelected?: boolean;
  onClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, onClick }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-slate-400';
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
      className={[
        'bg-black/40 p-4 rounded-xl border cursor-pointer',
        'transition-all duration-300',
        isSelected
          ? 'border-blue-500/40 bg-white/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
          : 'border-white/5 hover:border-blue-500/40 hover:bg-white/5 hover:shadow-[0_0_15px_rgba(59,130,246,0.1)]',
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
      <div className="flex items-center space-x-3">
        {/* Avatar with status dot */}
        <div className="relative flex-shrink-0">
          <div className="w-11 h-11 rounded-full bg-slate-900 overflow-hidden border border-white/10">
            <DicebearAvatar seed={agent.name} size={44} className="w-full h-full object-cover" />
          </div>
          <div
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#02040a] transition-colors duration-300 ${dotColor}`}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-semibold text-slate-200 truncate">{agent.name}</span>
            <div className="flex items-center gap-1.5">
              <Badge variant={variant} className="text-[10px] transition-colors duration-300">
                {agent.state}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-slate-400 truncate font-mono flex items-center gap-1">
            {ROLE_LABELS[agent.role] ?? agent.role}
            <Wrench className="h-2.5 w-2.5 text-slate-700 inline flex-shrink-0" />
          </p>
        </div>
      </div>

      {/* ── Task progress bar (slides in from right) ── */}
      {hasTask && (
        <div
          className={[
            'mt-2 flex items-center gap-1.5 text-[10px] font-mono',
            'transform transition-all duration-300',
            isComplete ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-slate-300',
          ].join(' ')}
          style={{
            animation: 'slideInRight 0.3s ease-out',
          }}
        >
          <span>{isComplete ? '✓' : isFailed ? '✗' : '📋'}</span>
          <span>
            {task.stepIndex + 1}/{task.totalSteps}
          </span>
          <span className="truncate max-w-[120px]">{truncate(task.stepLabel, 25)}</span>
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
        className="w-full flex items-center justify-between text-[10px] font-mono text-slate-400 hover:text-slate-300 transition-colors"
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
                  ? 'text-slate-500'
                  : st.status === 'failed'
                    ? 'text-red-400'
                    : 'text-slate-300',
              ].join(' ')}
            >
              {truncate(st.label, 25)}
            </span>
            {st.status === 'running' && st.startedAt && (
              <span className="text-slate-500 ml-auto">
                {Math.round((Date.now() - st.startedAt) / 1000)}s
              </span>
            )}
            {st.status === 'done' && <span className="text-slate-500 ml-auto">done</span>}
          </div>
        ))}
        {hiddenCount > 0 && !expanded && (
          <div className="text-[10px] font-mono text-slate-500 pl-4">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
