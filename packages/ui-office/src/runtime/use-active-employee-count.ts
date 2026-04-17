import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeState,
  EmployeeStatePayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';

export interface ActiveEmployeeCount {
  active: number;
  total: number;
  blocked: number;
}

const ACTIVE_STATES: ReadonlySet<EmployeeState> = new Set<EmployeeState>([
  'assigned',
  'thinking',
  'searching',
  'executing',
  'meeting',
  'reporting',
  'waiting',
]);

const BLOCKED_STATES: ReadonlySet<EmployeeState> = new Set<EmployeeState>(['blocked', 'failed']);

export function isEmployeeActive(state: EmployeeState): boolean {
  return ACTIVE_STATES.has(state);
}

export function isEmployeeBlocked(state: EmployeeState): boolean {
  return BLOCKED_STATES.has(state);
}

function deriveCounts(states: ReadonlyMap<string, EmployeeState>): ActiveEmployeeCount {
  let active = 0;
  let blocked = 0;
  for (const state of states.values()) {
    if (isEmployeeActive(state)) active++;
    else if (isEmployeeBlocked(state)) blocked++;
  }
  return { active, total: states.size, blocked };
}

function getBootstrapEmployeeCount(
  companyId: string | null,
  bootstrapEmployees: ReadonlyArray<{ company_id: string }>,
): number {
  if (!companyId) return 0;
  let count = 0;
  for (const row of bootstrapEmployees) {
    if (row.company_id === companyId) count++;
  }
  return count;
}

/**
 * Single source of truth for the "employees active" count surfaced in
 * StatusBar footer and 3D overlay. Owns one shared `Map<employeeId,
 * EmployeeState>`, derives `{ active, total, blocked }` via the locked
 * predicates above, and resets symmetrically on run-start and company switch.
 */
export function useActiveEmployeeCount(): ActiveEmployeeCount {
  const { eventBus, repos, bootstrapState } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const { activeCompanyId } = useCompany();

  const bootstrapEmployeeCount = getBootstrapEmployeeCount(
    activeCompanyId,
    bootstrapState?.reposSnapshot?.employees ?? [],
  );

  const statesRef = useRef<Map<string, EmployeeState>>(new Map());
  const [counts, setCounts] = useState<ActiveEmployeeCount>(() => ({
    active: 0,
    total: bootstrapEmployeeCount,
    blocked: 0,
  }));

  // Seed roster from bootstrap snapshot, then refine via repos when ready.
  useEffect(() => {
    statesRef.current.clear();
    const bootstrapEmployees = bootstrapState?.reposSnapshot?.employees ?? [];
    if (activeCompanyId) {
      for (const row of bootstrapEmployees) {
        if (row.company_id === activeCompanyId) {
          statesRef.current.set(row.employee_id, 'idle');
        }
      }
    }
    setCounts(deriveCounts(statesRef.current));

    if (!repos || !activeCompanyId) return;
    let cancelled = false;
    repos.employees.findByCompany(activeCompanyId).then((rows) => {
      if (cancelled) return;
      const states = statesRef.current;
      for (const row of rows) {
        if (!states.has(row.employee_id)) {
          states.set(row.employee_id, 'idle');
        }
      }
      setCounts(deriveCounts(states));
    });
    return () => {
      cancelled = true;
    };
  }, [repos, activeCompanyId, bootstrapState]);

  // Run-start reset: re-idle every known employee without clearing roster.
  useEffect(() => {
    if (!isRunning) return;
    const states = statesRef.current;
    for (const employeeId of states.keys()) {
      states.set(employeeId, 'idle');
    }
    setCounts(deriveCounts(states));
  }, [isRunning]);

  // Live event subscriptions — state transitions, roster add/remove.
  useEffect(() => {
    const unsubState = eventBus.on(
      'employee.state.',
      (event: RuntimeEvent<EmployeeStatePayload>) => {
        const { employeeId, next } = event.payload;
        const states = statesRef.current;
        const prev = states.get(employeeId);
        if (prev === next) return;
        states.set(employeeId, next);
        setCounts(deriveCounts(states));
      },
    );

    const unsubCreated = eventBus.on(
      'employee.created',
      (event: RuntimeEvent<EmployeeCreatedPayload>) => {
        const states = statesRef.current;
        if (states.has(event.payload.employeeId)) return;
        states.set(event.payload.employeeId, 'idle');
        setCounts(deriveCounts(states));
      },
    );

    const unsubDeleted = eventBus.on(
      'employee.deleted',
      (event: RuntimeEvent<EmployeeDeletedPayload>) => {
        const states = statesRef.current;
        if (!states.delete(event.payload.employeeId)) return;
        setCounts(deriveCounts(states));
      },
    );

    return () => {
      unsubState();
      unsubCreated();
      unsubDeleted();
    };
  }, [eventBus]);

  return counts;
}
