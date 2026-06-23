import { secretDecrypt, secretEncrypt } from '@/lib/local-secret.js';
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

// ── A2A Bearer-token at-rest sealing (S3) ──────────────────────────────────
//
// `employees.a2a_token` is an external-agent Bearer credential. The renderer is
// the sole writer/reader of this column in the desktop app today (the only
// *consumer* that sends the Bearer header is `@offisim/core`'s `A2AClient`,
// which is out of scope and runs in the runtime, not here). So we seal at this
// repo seam: encrypt on write, decrypt on read. Reads always hand plaintext
// back to callers, so existing renderer consumers (e.g. `useExternalEmployees`,
// which never surfaces the token) are unaffected.
//
// SEAM NOTE: if a future runtime consumer reads this column *directly* (not via
// this repo), it will see a sealed envelope and must decrypt it itself — the
// envelope format is documented in `apps/desktop/src-tauri/src/local_secret.rs`
// and the legacy-plaintext passthrough makes the migration non-breaking.

async function sealA2aToken(token: string | null | undefined): Promise<string | null> {
  if (token === null || token === undefined) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  return secretEncrypt(trimmed);
}

/** Decrypt `a2a_token` in-place on a freshly-read row (legacy plaintext passes through). */
async function unsealEmployeeRow(row: EmployeeRow): Promise<EmployeeRow> {
  if (row.a2a_token === null || row.a2a_token === undefined) return row;
  return { ...row, a2a_token: await secretDecrypt(row.a2a_token) };
}

async function unsealEmployeeRows(rows: EmployeeRow[]): Promise<EmployeeRow[]> {
  return Promise.all(rows.map(unsealEmployeeRow));
}

export interface EmployeesTauriRepos {
  employees: EmployeeRepository;
  employeeVersions: EmployeeVersionRepository;
}

export function createEmployeesTauriRepos(db: TauriDrizzleDb): EmployeesTauriRepos {
  const employees: EmployeeRepository = {
    async create(emp: NewEmployee) {
      const employee_id = emp.employee_id ?? crypto.randomUUID();
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
        is_external: emp.is_external ? 1 : 0,
        a2a_url: emp.a2a_url ?? null,
        a2a_token: await sealA2aToken(emp.a2a_token),
        a2a_agent_id: emp.a2a_agent_id ?? null,
        brand_key: emp.brand_key ?? null,
        agent_card_json: emp.agent_card_json ?? null,
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
      const row = rows[0] as EmployeeRow | undefined;
      return row ? await unsealEmployeeRow(row) : null;
    },
    async findByCompany(companyId) {
      const rows = (await db
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.company_id, companyId))) as EmployeeRow[];
      return unsealEmployeeRows(rows);
    },
    async findByRole(companyId, roleSlug) {
      const rows = (await db
        .select()
        .from(schema.employees)
        .where(
          and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)),
        )) as EmployeeRow[];
      return unsealEmployeeRows(rows);
    },
    async update(employeeId, patch) {
      // Seal `a2a_token` if this patch touches it; leave all other fields as-is.
      const sealedPatch =
        'a2a_token' in patch
          ? { ...patch, a2a_token: await sealA2aToken(patch.a2a_token) }
          : patch;
      await db
        .update(schema.employees)
        .set({ ...sealedPatch, updated_at: now() })
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
