import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useThreads } from '@/data/queries.js';
import type { Employee, EmployeePresence } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  ArrowDownNarrowWide,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const PRESENCE_CLS: Record<EmployeePresence, string> = {
  working: 'is-running',
  idle: '',
  blocked: 'is-blocked',
  failed: 'is-failed',
  offline: 'is-offline',
};

const PRESENCE_TEXT: Record<EmployeePresence, string> = {
  working: 'Working',
  idle: 'Idle',
  blocked: 'Blocked',
  failed: 'Failed',
  offline: 'Offline',
};

function presenceFor(employee: Employee, running: boolean): EmployeePresence {
  if (running) return 'working';
  return employee.presence ?? (employee.online ? 'idle' : 'offline');
}

export function TeamDock() {
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const setSurface = useUiState((s) => s.setSurface);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const roster = useMemo(
    () =>
      (employees.data ?? []).filter((e) =>
        e.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [employees.data, query],
  );

  return (
    <div className={cn('off-team', collapsed && 'is-collapsed')} aria-label="Team">
      <div className="off-dock-label">
        <span className="off-dock-title">Team</span>
        <span className="off-dock-count">{employees.data?.length ?? 0} people</span>
      </div>

      <div className="off-dock-strip">
        {roster.map((employee) => {
          const thread = threads.data?.find((t) => t.employeeId === employee.id);
          const running = thread?.runState === 'running';
          const active = Boolean(thread && thread.id === selectedThreadId);
          const presence = presenceFor(employee, running);
          return (
            <button
              type="button"
              key={employee.id}
              className={cn('off-team-card off-focusable', active && 'is-active')}
              onClick={() => (thread ? openThread(thread.id) : undefined)}
            >
              <EmployeeAvatar
                seed={employee.id}
                appearance={employee.appearance}
                colorA={employee.avatarA}
                colorB={employee.avatarB}
                size={36}
                brand={employee.kind === 'external'}
              />
              <span className="off-team-info">
                <span className="off-team-name">{employee.name}</span>
                <span className="off-team-role">{employee.role}</span>
                <span className={cn('off-team-status', PRESENCE_CLS[presence])}>
                  <span className="off-team-dot" />
                  {PRESENCE_TEXT[presence]}
                </span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="off-team-add off-focusable"
          onClick={() => setSurface('personnel')}
          aria-label="Hire employee"
        >
          <Icon icon={UserPlus} size="md" />
          <span>Hire</span>
        </button>
      </div>

      <div className="off-dock-tools">
        {showSearch ? (
          <input
            className="off-dock-search"
            value={query}
            placeholder="Search team…"
            onChange={(e) => setQuery(e.target.value)}
            // biome-ignore lint/a11y/noAutofocus: opens on explicit user action
            autoFocus
            onBlur={() => !query && setShowSearch(false)}
          />
        ) : (
          <IconButton
            icon={Search}
            label="Search team"
            size="iconSm"
            onClick={() => setShowSearch(true)}
          />
        )}
        <IconButton icon={Filter} label="Filter" size="iconSm" />
        <IconButton icon={ArrowDownNarrowWide} label="Sort" size="iconSm" />
        <IconButton
          icon={collapsed ? ChevronUp : ChevronDown}
          label={collapsed ? 'Expand dock' : 'Collapse dock'}
          size="iconSm"
          onClick={() => setCollapsed((v) => !v)}
        />
      </div>
    </div>
  );
}
