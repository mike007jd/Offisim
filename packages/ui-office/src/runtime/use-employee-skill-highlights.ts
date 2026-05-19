import type { RuntimeEvent, SkillInstallOutcomePayload } from '@offisim/shared-types';
import { SKILL_INSTALL_OUTCOME, skillInstallOutcomeLabel } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntimeServices } from './offisim-runtime-context';

const HIGHLIGHT_TTL_MS = 4_500;

const HIGHLIGHT_KINDS = new Set<SkillInstallOutcomePayload['kind']>([
  'installed',
  'created',
  'edited',
]);

export interface EmployeeSkillHighlight {
  readonly count: number;
  readonly label: string;
  readonly detail: string;
  readonly expiresAt: number;
}

export function useEmployeeSkillHighlights(): ReadonlyMap<string, EmployeeSkillHighlight> {
  const { eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [highlights, setHighlights] = useState<Map<string, EmployeeSkillHighlight>>(
    () => new Map(),
  );

  useEffect(() => {
    setHighlights(new Map());
    const timers = new Map<string, number>();

    const clearEmployeeTimer = (employeeId: string) => {
      const timer = timers.get(employeeId);
      if (timer != null) window.clearTimeout(timer);
      timers.delete(employeeId);
    };

    const scheduleClear = (employeeId: string, expiresAt: number) => {
      clearEmployeeTimer(employeeId);
      const delay = Math.max(0, expiresAt - Date.now());
      timers.set(
        employeeId,
        window.setTimeout(() => {
          setHighlights((prev) => {
            const current = prev.get(employeeId);
            if (!current || current.expiresAt > Date.now()) return prev;
            const next = new Map(prev);
            next.delete(employeeId);
            return next;
          });
          timers.delete(employeeId);
        }, delay),
      );
    };

    const off = eventBus.on(
      SKILL_INSTALL_OUTCOME,
      (event: RuntimeEvent<SkillInstallOutcomePayload>) => {
        if (activeCompanyId && event.companyId !== activeCompanyId) return;
        const payload = event.payload;
        const employeeId = payload.employeeId ?? null;
        if (!employeeId || !HIGHLIGHT_KINDS.has(payload.kind)) return;

        const expiresAt = Date.now() + HIGHLIGHT_TTL_MS;
        setHighlights((prev) => {
          const previous = prev.get(employeeId);
          const count = previous && previous.expiresAt > Date.now() ? previous.count + 1 : 1;
          const next = new Map(prev);
          next.set(employeeId, {
            count,
            label: count > 1 ? `Skill +${count}` : 'Skill updated',
            detail: skillInstallOutcomeLabel(payload),
            expiresAt,
          });
          return next;
        });
        scheduleClear(employeeId, expiresAt);
      },
    );

    return () => {
      off();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [activeCompanyId, eventBus]);

  return highlights;
}
