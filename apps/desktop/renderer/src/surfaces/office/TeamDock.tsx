import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useThreads } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { BlockAvatar } from '@/design-system/grammar/BlockAvatar.js';
import { cn, initialsOf } from '@/lib/utils.js';

function statusLabel(employee: Employee, running: boolean): { text: string; cls: string } {
  if (running) return { text: 'Running', cls: 'is-running' };
  if (employee.online) return { text: 'Online', cls: 'is-online' };
  return { text: 'Idle', cls: '' };
}

export function TeamDock() {
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const employees = useEmployees();
  const threads = useThreads(projectId);

  return (
    <div className="off-team" aria-label="Team">
      {employees.data?.map((employee) => {
        const thread = threads.data?.find((t) => t.employeeId === employee.id);
        const running = thread?.runState === 'running';
        const active = Boolean(thread && thread.id === selectedThreadId);
        const status = statusLabel(employee, running);
        return (
          <button
            type="button"
            key={employee.id}
            className={cn('off-team-card off-focusable', active && 'is-active')}
            onClick={() => (thread ? openThread(thread.id) : undefined)}
          >
            <BlockAvatar
              initials={initialsOf(employee.name)}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              size={36}
              brand={employee.kind === 'external'}
            />
            <span className="off-team-info">
              <span className="off-team-name">{employee.name}</span>
              <span className="off-team-role">{employee.role}</span>
              <span className={cn('off-team-status', status.cls)}>
                <span className="off-team-dot" />
                {status.text}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
