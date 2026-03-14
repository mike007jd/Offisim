import type { EmployeeRow, EmployeeUpdate } from '@aics/core/browser';
import { employeeUpdated } from '@aics/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { COMPANY_ID } from '../lib/constants.js';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

export interface UseEmployeeWorkshopReturn {
  /** All employees for the current company. */
  employees: EmployeeRow[];
  /** Whether the workshop overlay is open. */
  isOpen: boolean;
  /** Whether employees are being loaded. */
  isLoading: boolean;
  /** Update a single employee's fields and refresh the list. */
  updateEmployee: (id: string, patch: EmployeeUpdate) => Promise<void>;
  /** Apply a model profile string to all employees at once. */
  batchUpdateModel: (modelProfile: string) => Promise<void>;
  /** Apply a temperature to all employees at once. */
  batchUpdateTemperature: (temp: number) => Promise<void>;
  open: () => void;
  close: () => void;
}

export function useEmployeeWorkshop(): UseEmployeeWorkshopReturn {
  const { repos, eventBus } = useAicsRuntime();
  const [isOpen, setIsOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadEmployees = useCallback(async () => {
    if (!repos) return;
    setIsLoading(true);
    try {
      const rows = await repos.employees.findByCompany(COMPANY_ID);
      setEmployees(rows);
    } finally {
      setIsLoading(false);
    }
  }, [repos]);

  // Reload when workshop opens.
  useEffect(() => {
    if (isOpen) {
      loadEmployees();
    }
  }, [isOpen, loadEmployees]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const updateEmployee = useCallback(
    async (id: string, patch: EmployeeUpdate) => {
      if (!repos) return;
      await repos.employees.update(id, patch);
      // Emit event so other subscribers stay in sync.
      const updated = employees.find((e) => e.employee_id === id);
      if (updated) {
        const name = patch.name ?? updated.name;
        const roleSlug = patch.role_slug ?? updated.role_slug;
        eventBus.emit(employeeUpdated(COMPANY_ID, id, name, roleSlug));
      }
      // Refresh list
      await loadEmployees();
    },
    [repos, eventBus, employees, loadEmployees],
  );

  const batchUpdateModel = useCallback(
    async (modelProfile: string) => {
      if (!repos) return;
      await Promise.all(
        employees.map(async (emp) => {
          // Merge new modelPreference into existing config_json
          let existing: Record<string, unknown> = {};
          try {
            if (emp.config_json) existing = JSON.parse(emp.config_json);
          } catch {
            /* ignore */
          }
          const configJson = JSON.stringify({ ...existing, modelPreference: modelProfile });
          await repos.employees.update(emp.employee_id, { config_json: configJson });
        }),
      );
      await loadEmployees();
    },
    [repos, employees, loadEmployees],
  );

  const batchUpdateTemperature = useCallback(
    async (temp: number) => {
      if (!repos) return;
      await Promise.all(
        employees.map(async (emp) => {
          let existing: Record<string, unknown> = {};
          try {
            if (emp.config_json) existing = JSON.parse(emp.config_json);
          } catch {
            /* ignore */
          }
          const configJson = JSON.stringify({ ...existing, temperature: temp });
          await repos.employees.update(emp.employee_id, { config_json: configJson });
        }),
      );
      await loadEmployees();
    },
    [repos, employees, loadEmployees],
  );

  return {
    employees,
    isOpen,
    isLoading,
    updateEmployee,
    batchUpdateModel,
    batchUpdateTemperature,
    open,
    close,
  };
}
