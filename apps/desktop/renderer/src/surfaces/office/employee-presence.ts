import type { ChatThread, Employee, EmployeePresence } from '@/data/types.js';

/** One source of truth for the five employee states shown in the Office HUD. */
export function presenceFor(
  employee: Pick<Employee, 'online' | 'disabled'>,
  thread: Pick<ChatThread, 'runtimeStatus'> | null | undefined,
): EmployeePresence {
  if (employee.disabled || !employee.online) return 'offline';

  const status = thread?.runtimeStatus;
  if (status === 'queued' || status === 'running') return 'working';
  if (status === 'blocked' || status === 'paused') return 'blocked';
  if (status === 'failed') return 'failed';
  return 'idle';
}
