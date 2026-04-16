import type {
  EmployeeRepository,
  EmployeeRow,
  EmployeeVersionRepository,
  EmployeeVersionRow,
  NewEmployeeVersion,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import type { NewEmployee } from '@offisim/install-core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface EmployeesTauriRepos {
  employees: EmployeeRepository;
  employeeVersions: EmployeeVersionRepository;
}

export function createEmployeesTauriRepos(db: TauriDrizzleDb): EmployeesTauriRepos {
  const employees: EmployeeRepository = {
    async create(emp: NewEmployee) {
      const employee_id = crypto.randomUUID();
      const ts = now();
      const row = {
        employee_id,
        company_id: emp.company_id,
        source_asset_id: emp.source_asset_id,
        source_package_id: emp.source_package_id,
        name: emp.name,
        role_slug: emp.role_slug,
        workstation_id: null,
        persona_json: emp.persona_json ?? null,
        config_json: emp.config_json ?? null,
        enabled: 1,
        created_at: ts,
        updated_at: ts,
      };
      await db.insert(schema.employees).values(row);
      return { employee_id };
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.employee_id, id));
      return (rows[0] as EmployeeRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.company_id, companyId))) as EmployeeRow[];
    },
    async findByRole(companyId, roleSlug) {
      return (await db
        .select()
        .from(schema.employees)
        .where(
          and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)),
        )) as EmployeeRow[];
    },
    async update(employeeId, patch) {
      await db
        .update(schema.employees)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.employees.employee_id, employeeId));
    },
    async delete(employeeId) {
      await db.delete(schema.employees).where(eq(schema.employees.employee_id, employeeId));
    },
  };

  const employeeVersions: EmployeeVersionRepository = {
    async create(version: NewEmployeeVersion) {
      const row: EmployeeVersionRow = {
        ...version,
        version_id: crypto.randomUUID(),
        created_at: now(),
      };
      await db.insert(schema.employeeVersions).values(row);
      return row;
    },
    async findByEmployee(employeeId, opts) {
      let query = db
        .select()
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId))
        .orderBy(desc(schema.employeeVersions.version_num));
      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }
      return (await query) as EmployeeVersionRow[];
    },
    async findByVersion(employeeId, versionNum) {
      const rows = await db
        .select()
        .from(schema.employeeVersions)
        .where(
          and(
            eq(schema.employeeVersions.employee_id, employeeId),
            eq(schema.employeeVersions.version_num, versionNum),
          ),
        );
      return (rows[0] as EmployeeVersionRow | undefined) ?? null;
    },
    async getLatestVersionNum(employeeId) {
      const rows = await db
        .select({ maxVer: sql<number>`MAX(${schema.employeeVersions.version_num})` })
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId));
      return (rows[0] as { maxVer: number | null } | undefined)?.maxVer ?? 0;
    },
  };

  return { employees, employeeVersions };
}
