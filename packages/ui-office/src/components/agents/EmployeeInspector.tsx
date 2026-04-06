import { Badge, Button } from '@offisim/ui-core';
import { BriefcaseBusiness, ListChecks, MessageSquare, Pencil, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import type { AgentState } from '../../runtime/use-agent-states';
import { DicebearAvatar } from '../shared/DicebearAvatar';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmployeeInspectorProps {
  employeeId: string | null;
  agents: Map<string, AgentState>;
  onClose: () => void;
  onOpenEditor?: (id: string) => void;
  onStartChat?: (id: string) => void;
  leftOffset?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmployeeInspector({
  employeeId,
  agents,
  onClose,
  onOpenEditor,
  onStartChat,
  leftOffset = 280,
}: EmployeeInspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!employeeId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [employeeId, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!employeeId) return;
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Use capture so we catch clicks before they bubble
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [employeeId, onClose]);

  if (!employeeId) return null;

  const agent = agents.get(employeeId);
  if (!agent) return null;

  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-slate-400';
  const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;
  const subTaskTotal = agent.subTasks?.length ?? 0;
  const completedSubTasks =
    agent.subTasks?.filter((subTask) => subTask.status === 'done').length ?? 0;
  const runningSubTask = agent.subTasks?.find((subTask) => subTask.status === 'running') ?? null;
  const currentTaskLabel = agent.currentTask?.stepLabel ?? null;
  const stepProgress =
    agent.currentTask != null
      ? `Step ${agent.currentTask.stepIndex + 1} of ${agent.currentTask.totalSteps}`
      : null;

  return (
    <div
      ref={panelRef}
      className="fixed top-16 z-50 w-80 max-w-[min(22rem,calc(100vw-2rem))]"
      style={{ left: `${leftOffset}px` }}
      data-testid="employee-inspector"
    >
      {/* Floating card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-md">
        {/* Header row */}
        <div
          className="flex items-center justify-between border-b border-white/8"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Quick Inspect
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Close inspector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Identity section */}
        <div
          className="flex items-center gap-3"
          style={{
            paddingInline: 'var(--sp-lg)',
            paddingTop: 'var(--sp-lg)',
            paddingBottom: 'var(--sp-md)',
          }}
        >
          <div className="relative flex-shrink-0">
            <div className="h-12 w-12 overflow-hidden rounded-full border border-white/10 bg-slate-800">
              <DicebearAvatar seed={agent.name} size={48} className="h-full w-full object-cover" />
            </div>
            <div
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-900 ${dotColor}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-100">{agent.name}</p>
            <p className="truncate text-xs text-slate-400 font-mono">{roleLabel}</p>
          </div>
          <Badge variant={variant} className="text-xs flex-shrink-0">
            {agent.state}
          </Badge>
        </div>

        {/* Details */}
        <div
          className="flex flex-col gap-1"
          style={{ paddingInline: 'var(--sp-lg)', paddingBottom: 'var(--sp-md)' }}
        >
          {currentTaskLabel ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <BriefcaseBusiness className="h-3 w-3" />
                Current Focus
              </div>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-100">
                {currentTaskLabel}
              </p>
              {stepProgress ? <p className="mt-1 text-xs text-slate-400">{stepProgress}</p> : null}
            </div>
          ) : (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Current Focus
              </div>
              <p className="mt-2 text-sm text-slate-300">Available for the next assignment.</p>
            </div>
          )}

          {subTaskTotal > 0 ? (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <ListChecks className="h-3 w-3" />
                Subtasks
              </div>
              <p className="mt-2 text-sm text-slate-100">
                {completedSubTasks}/{subTaskTotal} complete
              </p>
              {runningSubTask ? (
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  In progress: {runningSubTask.label}
                </p>
              ) : null}
            </div>
          ) : null}

          {agent.taskRunId && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Task ID</span>
              <span className="font-mono text-slate-300 truncate max-w-[140px]">
                {agent.taskRunId.slice(0, 12)}…
              </span>
            </div>
          )}
          {agent.workstationId && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Workstation</span>
              <span className="font-mono text-slate-300">{agent.workstationId}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div
          className="flex gap-2 border-t border-white/8"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
        >
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onStartChat?.(employeeId)}
          >
            <MessageSquare className="h-3 w-3" />
            Message
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onOpenEditor?.(employeeId)}
          >
            <Pencil className="h-3 w-3" />
            Open details
          </Button>
        </div>
      </div>
    </div>
  );
}
