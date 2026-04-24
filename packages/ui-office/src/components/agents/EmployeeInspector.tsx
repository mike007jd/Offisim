import type { EmployeeRow, MemoryEntryRow } from '@offisim/core/browser';
import { Badge, Button, isAnyModalOpen } from '@offisim/ui-core';
import {
  Brain,
  BriefcaseBusiness,
  ListChecks,
  MessageSquare,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEmployeeMemories } from '../../hooks/useEmployeeMemories';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import type { AgentState } from '../../runtime/use-agent-states';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmployeeInspectorProps {
  employeeId: string | null;
  companyId: string;
  agents: Map<string, AgentState>;
  onClose: () => void;
  onOpenEditor?: (id: string) => void;
  onStartChat?: (id: string) => void;
  leftOffset?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Category badge colors
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<MemoryEntryRow['category'], string> = {
  experience: 'text-amber-400',
  decision: 'text-blue-400',
  knowledge: 'text-emerald-400',
  preference: 'text-purple-400',
};

// ---------------------------------------------------------------------------
// MemoriesSection — collapsible, top-5 by importance, Forget per entry
// ---------------------------------------------------------------------------

function MemoriesSection({
  employeeId,
  companyId,
}: {
  employeeId: string;
  companyId: string;
}) {
  const { memories, isLoading, deleteMemory } = useEmployeeMemories(employeeId, companyId);
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...memories].sort((a, b) => b.importance - a.importance),
    [memories],
  );
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const total = memories.length;

  const handleForget = useCallback(
    (memoryId: string) => {
      void deleteMemory(memoryId);
    },
    [deleteMemory],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <Brain className="h-3 w-3" />
          Memories
        </div>
        <p className="mt-2 text-xs text-slate-500">Loading…</p>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <Brain className="h-3 w-3" />
          Memories
        </div>
        <p className="mt-2 text-xs text-slate-400">No memories yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
          <Brain className="h-3 w-3" />
          Memories ({total})
        </div>
        <span className="text-[10px] text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>
      <div className="mt-2 flex flex-col gap-1.5">
        {visible.map((m) => (
          <div key={m.memory_id} className="group flex items-start gap-1.5">
            <span className="mt-0.5 text-[10px] text-slate-600">★</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-slate-200 break-words">{m.content}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[9px] ${CATEGORY_COLORS[m.category]}`}>{m.category}</span>
                <span className="text-[9px] text-slate-600">{m.importance.toFixed(2)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleForget(m.memory_id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 p-0.5"
              title="Forget this memory"
              aria-label={`Forget memory: ${m.content.slice(0, 30)}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {total > 5 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          Show all {total} memories
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmployeeInspector({
  employeeId,
  companyId,
  agents,
  onClose,
  onOpenEditor,
  onStartChat,
  leftOffset = 280,
}: EmployeeInspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { repos } = useOffisimRuntime();
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [isUpdatingEnabled, setIsUpdatingEnabled] = useState(false);

  // Close on Escape. Inspector is a popover (not stack-registered), so it must
  // ignore Escape when any modal above it owns keyboard input.
  useEffect(() => {
    if (!employeeId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (isAnyModalOpen()) return;
      onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [employeeId, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!employeeId) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) {
        return;
      }
      // Starting or continuing a direct chat should not clear the selected employee
      // before the chat surface receives the click.
      if (target instanceof Element && target.closest('[data-chat-panel-root]')) {
        return;
      }
      if (panelRef.current) {
        onClose();
      }
    }
    // Use capture so we catch clicks before they bubble
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [employeeId, onClose]);

  useEffect(() => {
    if (!employeeId || !repos?.employees) {
      setEmployee(null);
      return;
    }
    let cancelled = false;
    repos.employees
      .findById(employeeId)
      .then((row) => {
        if (!cancelled) {
          setEmployee(row);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEmployee(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, repos]);

  if (!employeeId) return null;
  const resolvedEmployeeId = employeeId;

  const agent = agents.get(resolvedEmployeeId);
  if (!agent) return null;

  const enabled = employee?.enabled ?? 1;
  const isDismissed = enabled === 0;
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

  async function updateEnabled(nextEnabled: 0 | 1) {
    if (!repos?.employees || isUpdatingEnabled) return;
    const targetId = resolvedEmployeeId;
    setIsUpdatingEnabled(true);
    try {
      await repos.employees.update(targetId, { enabled: nextEnabled });
      // Only update local state if still viewing the same employee
      setEmployee((prev) =>
        prev && prev.employee_id === targetId ? { ...prev, enabled: nextEnabled } : prev,
      );
    } finally {
      setIsUpdatingEnabled(false);
    }
  }

  function handleDismiss() {
    if (
      !window.confirm(
        "Dismiss this employee? They won't appear in the office but their memories are preserved. You can re-enable them later.",
      )
    ) {
      return;
    }
    void updateEnabled(0);
  }

  function handleReenable() {
    void updateEnabled(1);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: floating inspector is a popover anchored to rail, not a modal dialog
    <div
      ref={panelRef}
      className="fixed top-16 z-50 w-80 max-w-[min(22rem,calc(100vw-2rem))]"
      style={{ left: `${leftOffset}px` }}
      data-testid="employee-inspector"
      role="dialog"
      aria-label={`Inspecting ${agent.name}`}
    >
      {/* Floating card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-md">
        {/* Header row */}
        <div
          className="flex items-center justify-between border-b border-white/8"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wider text-slate-400"
            title="Anchored to the selected employee in the personnel rail"
          >
            Inspecting
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
              <EmployeeAvatar
                agent={employee ?? agent}
                size={48}
                className="h-full w-full object-cover"
              />
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
          {isDismissed ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-rose-300">Dismissed</div>
              <p className="mt-2 text-sm text-rose-100">
                This employee is hidden from the office. Their memories are preserved.
              </p>
            </div>
          ) : null}

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

          <MemoriesSection employeeId={employeeId} companyId={companyId} />

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
            onClick={() => onStartChat?.(resolvedEmployeeId)}
          >
            <MessageSquare className="h-3 w-3" />
            Message
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onOpenEditor?.(resolvedEmployeeId)}
          >
            <Pencil className="h-3 w-3" />
            Edit Details
          </Button>
          {isDismissed ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
              disabled={isUpdatingEnabled}
              onClick={handleReenable}
            >
              <UserPlus className="h-3 w-3" />
              Re-enable
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              disabled={isUpdatingEnabled}
              onClick={handleDismiss}
            >
              <UserMinus className="h-3 w-3" />
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
