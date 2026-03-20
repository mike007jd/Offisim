import { Badge, Button, type BadgeProps } from '@aics/ui-core';
import { MessageSquare, Pencil, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AgentState } from '../../runtime/use-agent-states';
import { DicebearAvatar } from '../shared/DicebearAvatar';
import { ROLE_LABELS } from '../../lib/roles';

// ---------------------------------------------------------------------------
// State badge config (mirrored from AgentCard)
// ---------------------------------------------------------------------------

const STATE_VARIANTS: Record<string, BadgeProps['variant']> = {
  idle: 'secondary',
  assigned: 'info',
  thinking: 'info',
  executing: 'success',
  meeting: 'default',
  blocked: 'error',
  failed: 'error',
  waiting: 'warning',
};

const STATUS_DOTS: Record<string, string> = {
  idle: 'bg-slate-400',
  assigned: 'bg-blue-500',
  thinking: 'bg-blue-500',
  executing: 'bg-emerald-500',
  meeting: 'bg-purple-500',
  blocked: 'bg-red-500',
  failed: 'bg-red-500',
  waiting: 'bg-amber-500',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmployeeInspectorProps {
  employeeId: string | null;
  agents: Map<string, AgentState>;
  onClose: () => void;
  onOpenEditor?: (id: string) => void;
  onStartChat?: (id: string) => void;
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

  return (
    <div
      ref={panelRef}
      className="fixed left-[280px] top-16 z-50 w-72 max-w-xs"
      data-testid="employee-inspector"
    >
      {/* Floating card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-md">
        {/* Header row */}
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Employee Profile
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
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
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
        <div className="flex flex-col gap-1 px-4 pb-3">
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
          {!agent.taskRunId && !agent.workstationId && (
            <p className="text-xs text-slate-500 italic">No active task</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-white/8 px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onStartChat?.(employeeId)}
          >
            <MessageSquare className="h-3 w-3" />
            Chat
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onOpenEditor?.(employeeId)}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
        </div>
      </div>
    </div>
  );
}
