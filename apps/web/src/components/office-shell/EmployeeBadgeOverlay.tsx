import { isTauri } from '@offisim/ui-office/web';
import { useEffect, useState } from 'react';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function EmployeeBadgeOverlay({ employeeId }: { employeeId: string }) {
  const [count, setCount] = useState(0);

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

  if (count <= 0) return null;

  return (
    <div
      aria-label={`${count} active kanban card${count === 1 ? '' : 's'}`}
      style={{
        minWidth: '18px',
        height: '18px',
        borderRadius: '9999px',
        background: 'var(--color-kelp-green)',
        color: 'var(--color-text-inverse-val)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        fontWeight: 900,
        boxShadow: '0 0 10px color-mix(in srgb, var(--color-kelp-green) 55%, transparent)',
        paddingInline: '5px',
      }}
    >
      {count > 99 ? '99+' : count}
    </div>
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
