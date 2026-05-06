import type { EmployeeRow, MemoryEntryRow } from '@offisim/core/browser';
import { Badge, Button, cn, isAnyModalOpen } from '@offisim/ui-core';
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
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useEmployeeMemories } from '../../hooks/useEmployeeMemories.js';
import type { AddToast } from '../../lib/discard-confirm-toast.js';
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
  /** Surface mutation failures via the runtime toast channel. */
  addToast?: AddToast;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<MemoryEntryRow['category'], string> = {
  experience: 'text-warning',
  decision: 'text-info',
  knowledge: 'text-success',
  preference: 'text-accent',
};

const INSPECTOR_LABEL_CLASS =
  'flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-muted';

const SECTION_ROW_CLASS = 'border-t border-border-subtle';
const SECTION_PADDING_STYLE = {
  paddingInline: 'var(--sp-lg)',
  paddingBlock: 'var(--sp-md)',
} as const;

// ---------------------------------------------------------------------------
// MemoriesSection — <details> disclosure, no inner card
// ---------------------------------------------------------------------------

function MemoriesSection({
  employeeId,
  companyId,
}: {
  employeeId: string;
  companyId: string;
}) {
  const { memories, isLoading, deleteMemory } = useEmployeeMemories(employeeId, companyId);
  const [isOpen, setIsOpen] = useState(false);

  const sorted = useMemo(
    () => [...memories].sort((a, b) => b.importance - a.importance),
    [memories],
  );
  const total = memories.length;

  const handleForget = useCallback(
    (memoryId: string) => {
      void deleteMemory(memoryId);
    },
    [deleteMemory],
  );

  const summaryLabel = isLoading ? 'Memories' : `Memories (${total})`;

  return (
    <details
      className={SECTION_ROW_CLASS}
      style={SECTION_PADDING_STYLE}
      open={isOpen}
      onToggle={(event) => setIsOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="flex w-full cursor-pointer select-none items-center justify-between marker:hidden [&::-webkit-details-marker]:hidden">
        <div className={INSPECTOR_LABEL_CLASS}>
          <Brain className="h-3 w-3" />
          {summaryLabel}
        </div>
        <span className="text-[10px] text-text-muted">{isOpen ? '▾' : '▸'}</span>
      </summary>
      <div className="mt-2">
        {isLoading ? (
          <p className="text-xs text-text-muted">Loading...</p>
        ) : total === 0 ? (
          <p className="text-xs text-text-secondary">No memories yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.map((m) => (
              <div key={m.memory_id} className="group flex items-start gap-1.5">
                <span className="mt-0.5 text-[10px] text-text-muted">★</span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs leading-relaxed text-text-primary">
                    {m.content}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={`text-[9px] ${CATEGORY_COLORS[m.category]}`}>
                      {m.category}
                    </span>
                    <span className="text-[9px] text-text-muted">{m.importance.toFixed(2)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleForget(m.memory_id)}
                  className="p-0.5 text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                  title="Forget this memory"
                  aria-label={`Forget memory: ${m.content.slice(0, 30)}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// InspectorFooterButton — icon-only at tablet/narrow tiers
// ---------------------------------------------------------------------------

function InspectorFooterButton({
  icon,
  label,
  onClick,
  disabled,
  showLabel,
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  showLabel: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('flex-1 gap-1.5 text-xs', className)}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
      {showLabel ? label : null}
    </Button>
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
  addToast,
}: EmployeeInspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { repos } = useOffisimRuntime();
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [isUpdatingEnabled, setIsUpdatingEnabled] = useState(false);
  const layoutTier = useLayoutTier();
  const showFooterLabels = layoutTier.tier === 'desktop';

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
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-text-muted';
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
    const previousEnabled: 0 | 1 = nextEnabled === 0 ? 1 : 0;
    setIsUpdatingEnabled(true);
    // Optimistic flip — update local state in the same render as the click.
    setEmployee((prev) =>
      prev && prev.employee_id === targetId ? { ...prev, enabled: nextEnabled } : prev,
    );
    try {
      await repos.employees.update(targetId, { enabled: nextEnabled });
    } catch (err) {
      // Roll back only the matching employee — the user may have navigated away.
      setEmployee((prev) =>
        prev && prev.employee_id === targetId ? { ...prev, enabled: previousEnabled } : prev,
      );
      const message =
        err instanceof Error && err.message ? err.message : 'Failed to update employee status';
      addToast?.(message, 'error');
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

  const hasMetadataRow = Boolean(agent.taskRunId || agent.workstationId);

  return (
    <div
      ref={panelRef}
      className="fixed top-16 z-50 w-80 max-w-[min(22rem,calc(100vw-2rem))]"
      style={{ left: `${leftOffset}px` }}
      data-testid="employee-inspector"
      // biome-ignore lint/a11y/useSemanticElements: floating inspector is a popover anchored to rail, not a modal dialog
      role="dialog"
      aria-label={`Inspecting ${agent.name}`}
    >
      {/* Single elevated SurfaceCard — sections are dividers, never nested cards. */}
      <div className="rounded-xl border border-border-default bg-surface-elevated text-text-primary shadow-2xl backdrop-blur-md">
        {/* Header row */}
        <div
          className="flex items-center justify-between border-b border-border-subtle"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
            title="Anchored to the selected employee in the personnel rail"
          >
            Inspecting
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted transition-colors hover:text-text-primary"
            aria-label="Close inspector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Identity row — first content row, no border-t (header has border-b). */}
        <div
          className="flex items-center gap-3"
          style={{
            paddingInline: 'var(--sp-lg)',
            paddingTop: 'var(--sp-lg)',
            paddingBottom: 'var(--sp-md)',
          }}
        >
          <div className="relative flex-shrink-0">
            <div className="h-12 w-12 overflow-hidden rounded-full border border-border-subtle bg-surface-muted">
              <EmployeeAvatar
                agent={employee ?? agent}
                size={48}
                className="h-full w-full object-cover"
              />
            </div>
            <div
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface-elevated ${dotColor}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{agent.name}</p>
            <p className="truncate font-mono text-xs text-text-secondary">{roleLabel}</p>
          </div>
          <Badge variant={variant} className="flex-shrink-0 text-xs">
            {agent.state}
          </Badge>
        </div>

        {/* Dismissed banner — flat row with error tone, no nested card. */}
        {isDismissed ? (
          <div className={SECTION_ROW_CLASS} style={SECTION_PADDING_STYLE}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-error">Dismissed</div>
            <p className="mt-2 text-sm text-error">
              This employee is hidden from the office. Their memories are preserved.
            </p>
          </div>
        ) : null}

        {/* Current focus row */}
        <div className={SECTION_ROW_CLASS} style={SECTION_PADDING_STYLE}>
          <div className={INSPECTOR_LABEL_CLASS}>
            <BriefcaseBusiness className="h-3 w-3" />
            Current Focus
          </div>
          {currentTaskLabel ? (
            <>
              <p className="mt-2 text-sm font-medium leading-relaxed text-text-primary">
                {currentTaskLabel}
              </p>
              {stepProgress ? (
                <p className="mt-1 text-xs text-text-secondary">{stepProgress}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-text-secondary">Available for the next assignment.</p>
          )}
        </div>

        {/* Subtasks row (only when present) */}
        {subTaskTotal > 0 ? (
          <div className={SECTION_ROW_CLASS} style={SECTION_PADDING_STYLE}>
            <div className={INSPECTOR_LABEL_CLASS}>
              <ListChecks className="h-3 w-3" />
              Subtasks
            </div>
            <p className="mt-2 text-sm text-text-primary">
              {completedSubTasks}/{subTaskTotal} complete
            </p>
            {runningSubTask ? (
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                In progress: {runningSubTask.label}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Memories disclosure — collapsed by default. */}
        <MemoriesSection employeeId={employeeId} companyId={companyId} />

        {/* Metadata row (Task ID / Workstation) */}
        {hasMetadataRow ? (
          <div className={`${SECTION_ROW_CLASS} flex flex-col gap-1`} style={SECTION_PADDING_STYLE}>
            {agent.taskRunId ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Task ID</span>
                <span className="max-w-[140px] truncate font-mono text-text-secondary">
                  {agent.taskRunId.slice(0, 12)}...
                </span>
              </div>
            ) : null}
            {agent.workstationId ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Workstation</span>
                <span className="font-mono text-text-secondary">{agent.workstationId}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Footer actions — flex-wrap, icon-only at tablet/narrow tiers. */}
        <div
          className="flex flex-wrap gap-2 border-t border-border-subtle"
          style={{ paddingInline: 'var(--sp-lg)', paddingBlock: 'var(--sp-md)' }}
        >
          <InspectorFooterButton
            icon={<MessageSquare className="h-3 w-3" />}
            label="Message"
            showLabel={showFooterLabels}
            onClick={() => onStartChat?.(resolvedEmployeeId)}
          />
          <InspectorFooterButton
            icon={<Pencil className="h-3 w-3" />}
            label="Edit Details"
            showLabel={showFooterLabels}
            onClick={() => onOpenEditor?.(resolvedEmployeeId)}
          />
          {isDismissed ? (
            <InspectorFooterButton
              icon={<UserPlus className="h-3 w-3" />}
              label="Re-enable"
              showLabel={showFooterLabels}
              disabled={isUpdatingEnabled}
              onClick={handleReenable}
              className="text-success hover:text-success"
            />
          ) : (
            <InspectorFooterButton
              icon={<UserMinus className="h-3 w-3" />}
              label="Dismiss"
              showLabel={showFooterLabels}
              disabled={isUpdatingEnabled}
              onClick={handleDismiss}
              className="text-error hover:bg-error-muted hover:text-error"
            />
          )}
        </div>
      </div>
    </div>
  );
}
