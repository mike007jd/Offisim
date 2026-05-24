import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeState,
  EmployeeStatePayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntimeServices, useOffisimRuntimeStatus } from './offisim-runtime-context';

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

export function isEmployeeActive(state: string): boolean {
  return ACTIVE_STATES.has(state as EmployeeState);
}

export function isEmployeeBlocked(state: string): boolean {
  return BLOCKED_STATES.has(state as EmployeeState);
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

function sameCounts(a: ActiveEmployeeCount, b: ActiveEmployeeCount): boolean {
  return a.active === b.active && a.total === b.total && a.blocked === b.blocked;
}

/**
 * Single source of truth for the "employees active" count surfaced in scene and
 * dashboard readouts. Owns one shared `Map<employeeId, EmployeeState>`, derives
 * `{ active, total, blocked }` via the locked predicates above, and resets
 * symmetrically on run-start and company switch.
 */
export function useActiveEmployeeCount(): ActiveEmployeeCount {
  const { eventBus, repos } = useOffisimRuntimeServices();
  const { isRunning } = useOffisimRuntimeStatus();
  const { activeCompanyId } = useCompany();

  const statesRef = useRef<Map<string, EmployeeState>>(new Map());
  const [counts, setCounts] = useState<ActiveEmployeeCount>({ active: 0, total: 0, blocked: 0 });

  // Seed roster from desktop repos when ready.
  useEffect(() => {
    statesRef.current.clear();
    if (!repos || !activeCompanyId) {
      setCounts((prev) => {
        const next = deriveCounts(statesRef.current);
        return sameCounts(prev, next) ? prev : next;
      });
      return;
    }
    let cancelled = false;
    repos.employees.findByCompany(activeCompanyId).then((rows) => {
      if (cancelled) return;
      const states = statesRef.current;
      for (const row of rows) {
        if (!states.has(row.employee_id)) {
          states.set(row.employee_id, 'idle');
        }
      }
      setCounts((prev) => {
        const next = deriveCounts(states);
        return sameCounts(prev, next) ? prev : next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repos, activeCompanyId]);

  // Run-start reset: re-idle every known employee without clearing roster.
  useEffect(() => {
    if (!isRunning) return;
    const states = statesRef.current;
    for (const employeeId of states.keys()) {
      states.set(employeeId, 'idle');
    }
    setCounts((prev) => {
      const next = deriveCounts(states);
      return sameCounts(prev, next) ? prev : next;
    });
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
        setCounts((prev) => {
          const next = deriveCounts(states);
          return sameCounts(prev, next) ? prev : next;
        });
      },
    );

    const unsubCreated = eventBus.on(
      'employee.created',
      (event: RuntimeEvent<EmployeeCreatedPayload>) => {
        const states = statesRef.current;
        if (states.has(event.payload.employeeId)) return;
        states.set(event.payload.employeeId, 'idle');
        setCounts((prev) => {
          const next = deriveCounts(states);
          return sameCounts(prev, next) ? prev : next;
        });
      },
    );

    const unsubDeleted = eventBus.on(
      'employee.deleted',
      (event: RuntimeEvent<EmployeeDeletedPayload>) => {
        const states = statesRef.current;
        if (!states.delete(event.payload.employeeId)) return;
        setCounts((prev) => {
          const next = deriveCounts(states);
          return sameCounts(prev, next) ? prev : next;
        });
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
