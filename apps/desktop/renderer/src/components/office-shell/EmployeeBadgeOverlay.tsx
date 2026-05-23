import { isTauri, useEmployeeSkillHighlights } from '@offisim/ui-office/web';
import { useEffect, useState } from 'react';
import { EmployeeBadgeStack, EmployeeKanbanBadge, EmployeeSkillBadge } from './OfficeShellSurfaces';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function EmployeeBadgeOverlay({ employeeId }: { employeeId: string }) {
  const [count, setCount] = useState(0);
  const skillHighlight = useEmployeeSkillHighlights().get(employeeId);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      const next = await fetchEmployeeKanbanCount(employeeId).catch(() => 0);
      if (!disposed) setCount(next);
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [employeeId]);

  if (count <= 0 && !skillHighlight) return null;

  return (
    <EmployeeBadgeStack
      aria-label={skillHighlight?.detail ?? `${count} active kanban card${count === 1 ? '' : 's'}`}
    >
      {skillHighlight ? <EmployeeSkillBadge>{skillHighlight.label}</EmployeeSkillBadge> : null}
      {count > 0 ? <EmployeeKanbanBadge>{count > 99 ? '99+' : count}</EmployeeKanbanBadge> : null}
    </EmployeeBadgeStack>
  );
}

async function fetchEmployeeKanbanCount(employeeId: string): Promise<number> {
  if (isTauri()) {
    const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
    return invoke<number>('count_kanban_for_employee', { employeeId });
  }

  const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/kanban-count`);
  if (!res.ok) return 0;
  const payload = (await res.json()) as { count?: unknown };
  return typeof payload.count === 'number' ? payload.count : 0;
}
