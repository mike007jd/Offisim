import * as schema from '@offisim/db-local/dist/schema.js';
import type { NewEmployee } from '@offisim/install-core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  EmployeeRepository,
  EmployeeRow,
  EmployeeVersionRepository,
  EmployeeVersionRow,
  NewEmployeeVersion,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface EmployeesDrizzleRepos {
  employees: EmployeeRepository;
  employeeVersions: EmployeeVersionRepository;
}

export function createEmployeesDrizzleRepos(db: Db): EmployeesDrizzleRepos {
  const employees: EmployeeRepository = {
    // NOTE: not `async` — lets synchronous throws from better-sqlite3 escape to
    // the caller's transact() callback so the transaction rolls back instead of
    // committing partial state (an async wrapper would capture the throw into a
    // rejected promise that `void repo.create(...)` silently discards).
    create(emp: NewEmployee) {
      const employee_id = emp.employee_id ?? crypto.randomUUID();
      const ts = now();
      db.insert(schema.employees)
        .values({
          employee_id,
          company_id: emp.company_id,
          source_asset_id: emp.source_asset_id,
          source_package_id: emp.source_package_id,
          name: emp.name,
          role_slug: emp.role_slug,
          persona_json: emp.persona_json ?? null,
          config_json: emp.config_json ?? null,
          model: emp.model ?? null,
          thinking_level: emp.thinking_level ?? null,
          is_external: emp.is_external ? 1 : 0,
          a2a_url: emp.a2a_url ?? null,
          a2a_token: emp.a2a_token ?? null,
          a2a_agent_id: emp.a2a_agent_id ?? null,
          brand_key: emp.brand_key ?? null,
          agent_card_json: emp.agent_card_json ?? null,
          created_at: ts,
          updated_at: ts,
        })
        .run();
      return Promise.resolve({ employee_id });
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.employee_id, id))
        .all();
      return (
        (rows[0] as unknown as ReturnType<EmployeeRepository['findById']> extends Promise<infer T>
          ? T
          : never) ?? null
      );
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.company_id, companyId))
        .all() as EmployeeRow[];
    },
    async findByRole(companyId, roleSlug) {
      return db
        .select()
        .from(schema.employees)
        .where(
          and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)),
        )
        .all() as EmployeeRow[];
    },
    async update(employeeId, patch) {
      db.update(schema.employees)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.employees.employee_id, employeeId))
        .run();
    },
    async delete(employeeId) {
      db.delete(schema.employees).where(eq(schema.employees.employee_id, employeeId)).run();
    },
  };

  const employeeVersions: EmployeeVersionRepository = {
    async create(version: NewEmployeeVersion) {
      const row: EmployeeVersionRow = {
        ...version,
        version_id: crypto.randomUUID(),
        created_at: now(),
      };
      db.insert(schema.employeeVersions).values(row).run();
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
      return query.all() as EmployeeVersionRow[];
    },
    async findByVersion(employeeId, versionNum) {
      const rows = db
        .select()
        .from(schema.employeeVersions)
        .where(
          and(
            eq(schema.employeeVersions.employee_id, employeeId),
            eq(schema.employeeVersions.version_num, versionNum),
          ),
        )
        .all();
      return (rows[0] as EmployeeVersionRow | undefined) ?? null;
    },
    async getLatestVersionNum(employeeId) {
      const rows = db
        .select({ maxVer: sql<number>`MAX(${schema.employeeVersions.version_num})` })
        .from(schema.employeeVersions)
        .where(eq(schema.employeeVersions.employee_id, employeeId))
        .all();
      return (rows[0] as { maxVer: number | null } | undefined)?.maxVer ?? 0;
    },
  };

  return { employees, employeeVersions };
}
