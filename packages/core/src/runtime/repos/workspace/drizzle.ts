import * as schema from '@offisim/db-local/dist/schema.js';
import type { ZoneRow } from '@offisim/shared-types';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { NewZone } from '../../../repos/zone-repository.js';
import type {
  NewOfficeLayout,
  NewSopTemplate,
  OfficeLayoutRow,
  RuntimeRepositories,
  SopTemplateRow,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface WorkspaceDrizzleRepos {
  sopTemplates: RuntimeRepositories['sopTemplates'];
  officeLayouts: RuntimeRepositories['officeLayouts'];
  prefabInstances: RuntimeRepositories['prefabInstances'];
  zones: RuntimeRepositories['zones'];
}

export function createWorkspaceDrizzleRepos(db: Db): WorkspaceDrizzleRepos {
  const sopTemplates: RuntimeRepositories['sopTemplates'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(template: NewSopTemplate) {
      const ts = now();
      const row: SopTemplateRow = { ...template, created_at: ts, updated_at: ts };
      db.insert(schema.sopTemplates).values(row).run();
      return Promise.resolve(row);
    },
    async findById(sopTemplateId) {
      const rows = db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .all();
      return (rows[0] as SopTemplateRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.company_id, companyId))
        .all() as SopTemplateRow[];
    },
    async update(sopTemplateId, patch) {
      db.update(schema.sopTemplates)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .run();
    },
    async delete(sopTemplateId) {
      db.delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId))
        .run();
    },
  };

  const officeLayouts: RuntimeRepositories['officeLayouts'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(layout: NewOfficeLayout) {
      const ts = now();
      const row: OfficeLayoutRow = { ...layout, created_at: ts, updated_at: ts };
      db.insert(schema.officeLayouts).values(row).run();
      return Promise.resolve(row);
    },
    async findById(layoutId) {
      const rows = db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId))
        .all();
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.company_id, companyId))
        .all() as OfficeLayoutRow[];
    },
    async findActive(companyId) {
      const rows = db
        .select()
        .from(schema.officeLayouts)
        .where(
          and(
            eq(schema.officeLayouts.company_id, companyId),
            eq(schema.officeLayouts.is_active, 1),
          ),
        )
        .all();
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async setActive(companyId, layoutId) {
      db.transaction((tx) => {
        tx.update(schema.officeLayouts)
          .set({ is_active: 0, updated_at: now() })
          .where(eq(schema.officeLayouts.company_id, companyId))
          .run();
        const result = tx
          .update(schema.officeLayouts)
          .set({ is_active: 1, updated_at: now() })
          .where(
            and(
              eq(schema.officeLayouts.layout_id, layoutId),
              eq(schema.officeLayouts.company_id, companyId),
            ),
          )
          .run();
        if (result.changes === 0) {
          throw new Error(`Layout ${layoutId} not found for company ${companyId}`);
        }
      });
    },
    async update(layoutId, patch) {
      db.update(schema.officeLayouts)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId))
        .run();
    },
    async delete(layoutId) {
      db.delete(schema.officeLayouts).where(eq(schema.officeLayouts.layout_id, layoutId)).run();
    },
  };

  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(instance) {
      db.insert(schema.prefabInstances).values(instance).run();
      return Promise.resolve(instance);
    },
    async findById(instanceId) {
      const rows = db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .all();
      return (rows[0] ?? null) as ReturnType<
        RuntimeRepositories['prefabInstances']['findById']
      > extends Promise<infer R>
        ? R
        : never;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return db
        .select()
        .from(schema.prefabInstances)
        .where(
          and(
            eq(schema.prefabInstances.company_id, companyId),
            eq(schema.prefabInstances.zone_id, zoneId),
          ),
        )
        .all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))
        .all() as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async update(instanceId, fields) {
      db.update(schema.prefabInstances)
        .set({
          ...fields,
          updated_at: now(),
        })
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .run();
    },
    async delete(instanceId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId))
        .run();
    },
    async deleteByCompany(companyId) {
      db.delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))
        .run();
    },
  };

  const zones: RuntimeRepositories['zones'] = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(zone: NewZone) {
      const ts = now();
      const row: ZoneRow = { ...zone, created_at: ts, updated_at: ts };
      db.insert(schema.zones).values(row).run();
      return Promise.resolve(row);
    },
    async findById(zoneId) {
      const rows = db.select().from(schema.zones).where(eq(schema.zones.zone_id, zoneId)).all();
      return (rows[0] as ZoneRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.zones)
        .where(eq(schema.zones.company_id, companyId))
        .all() as ZoneRow[];
    },
    async update(zoneId, fields) {
      db.update(schema.zones)
        .set({ ...fields, updated_at: now() })
        .where(eq(schema.zones.zone_id, zoneId))
        .run();
    },
    async delete(zoneId) {
      db.delete(schema.zones).where(eq(schema.zones.zone_id, zoneId)).run();
    },
    async deleteByCompany(companyId) {
      db.delete(schema.zones).where(eq(schema.zones.company_id, companyId)).run();
    },
  };

  return { sopTemplates, officeLayouts, prefabInstances, zones };
}
