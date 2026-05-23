import type {
  CompanyTemplateAssetRow,
  NewCompanyTemplateAsset,
  NewOfficeLayout,
  NewSopTemplate,
  OfficeLayoutRow,
  RuntimeRepositories,
  SopTemplateRow,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { and, eq } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface WorkspaceTauriRepos {
  sopTemplates: RuntimeRepositories['sopTemplates'];
  companyTemplates: RuntimeRepositories['companyTemplates'];
  officeLayouts: RuntimeRepositories['officeLayouts'];
  prefabInstances: RuntimeRepositories['prefabInstances'];
  zones: RuntimeRepositories['zones'];
}

export function createWorkspaceTauriRepos(db: TauriDrizzleDb): WorkspaceTauriRepos {
  const sopTemplates: RuntimeRepositories['sopTemplates'] = {
    async create(template: NewSopTemplate) {
      const ts = now();
      const row: SopTemplateRow = { ...template, created_at: ts, updated_at: ts };
      await db.insert(schema.sopTemplates).values(row);
      return row;
    },
    async findById(sopTemplateId) {
      const rows = await db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
      return (rows[0] as SopTemplateRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.sopTemplates)
        .where(eq(schema.sopTemplates.company_id, companyId))) as SopTemplateRow[];
    },
    async update(sopTemplateId, patch) {
      await db
        .update(schema.sopTemplates)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
    },
    async delete(sopTemplateId) {
      await db
        .delete(schema.sopTemplates)
        .where(eq(schema.sopTemplates.sop_template_id, sopTemplateId));
    },
  };

  const companyTemplates: RuntimeRepositories['companyTemplates'] = {
    async create(template: NewCompanyTemplateAsset) {
      const ts = now();
      const row: CompanyTemplateAssetRow = { ...template, created_at: ts, updated_at: ts };
      await db.insert(schema.companyTemplateAssets).values(row);
      return row;
    },
    async findById(companyTemplateAssetId) {
      const rows = await db
        .select()
        .from(schema.companyTemplateAssets)
        .where(eq(schema.companyTemplateAssets.company_template_asset_id, companyTemplateAssetId));
      return (rows[0] as CompanyTemplateAssetRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.companyTemplateAssets)
        .where(eq(schema.companyTemplateAssets.company_id, companyId))) as CompanyTemplateAssetRow[];
    },
    async delete(companyTemplateAssetId) {
      await db
        .delete(schema.companyTemplateAssets)
        .where(eq(schema.companyTemplateAssets.company_template_asset_id, companyTemplateAssetId));
    },
  };

  const officeLayouts: RuntimeRepositories['officeLayouts'] = {
    async create(layout: NewOfficeLayout) {
      const ts = now();
      const row: OfficeLayoutRow = { ...layout, created_at: ts, updated_at: ts };
      await db.insert(schema.officeLayouts).values(row);
      return row;
    },
    async findById(layoutId: string) {
      const rows = await db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.layout_id, layoutId));
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async findByCompany(companyId: string) {
      return (await db
        .select()
        .from(schema.officeLayouts)
        .where(eq(schema.officeLayouts.company_id, companyId))) as OfficeLayoutRow[];
    },
    async findActive(companyId: string) {
      const rows = await db
        .select()
        .from(schema.officeLayouts)
        .where(
          and(
            eq(schema.officeLayouts.company_id, companyId),
            eq(schema.officeLayouts.is_active, 1),
          ),
        );
      return (rows[0] as OfficeLayoutRow | undefined) ?? null;
    },
    async setActive(companyId: string, layoutId: string) {
      await db
        .update(schema.officeLayouts)
        .set({ is_active: 0, updated_at: now() })
        .where(eq(schema.officeLayouts.company_id, companyId));
      await db
        .update(schema.officeLayouts)
        .set({ is_active: 1, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId));
    },
    async update(layoutId: string, patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>) {
      await db
        .update(schema.officeLayouts)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.officeLayouts.layout_id, layoutId));
    },
    async delete(layoutId: string) {
      await db.delete(schema.officeLayouts).where(eq(schema.officeLayouts.layout_id, layoutId));
    },
  };

  const prefabInstances: RuntimeRepositories['prefabInstances'] = {
    async create(instance) {
      await db.insert(schema.prefabInstances).values(instance);
      return instance;
    },
    async findById(instanceId) {
      const rows = await db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
      return (rows[0] ?? null) as Awaited<
        ReturnType<RuntimeRepositories['prefabInstances']['findById']>
      >;
    },
    async findByCompanyAndZone(companyId, zoneId) {
      return (await db
        .select()
        .from(schema.prefabInstances)
        .where(
          and(
            eq(schema.prefabInstances.company_id, companyId),
            eq(schema.prefabInstances.zone_id, zoneId),
          ),
        )) as Awaited<ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>>;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId))) as Awaited<
        ReturnType<RuntimeRepositories['prefabInstances']['findByCompany']>
      >;
    },
    async update(instanceId, fields) {
      await db
        .update(schema.prefabInstances)
        .set({
          ...fields,
          updated_at: new Date().toISOString(),
        })
        .where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async delete(instanceId) {
      await db
        .delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.instance_id, instanceId));
    },
    async deleteByCompany(companyId) {
      await db
        .delete(schema.prefabInstances)
        .where(eq(schema.prefabInstances.company_id, companyId));
    },
  };

  const zones: RuntimeRepositories['zones'] = {
    async create(zone) {
      const row = {
        ...zone,
        created_at: now(),
        updated_at: now(),
      };
      await db.insert(schema.zones).values(row);
      return row;
    },
    async findById(zoneId) {
      const rows = await db.select().from(schema.zones).where(eq(schema.zones.zone_id, zoneId));
      return (rows[0] ?? null) as Awaited<ReturnType<RuntimeRepositories['zones']['findById']>>;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.zones)
        .where(eq(schema.zones.company_id, companyId))) as Awaited<
        ReturnType<RuntimeRepositories['zones']['findByCompany']>
      >;
    },
    async update(zoneId, fields) {
      await db
        .update(schema.zones)
        .set({
          ...fields,
          updated_at: now(),
        })
        .where(eq(schema.zones.zone_id, zoneId));
    },
    async delete(zoneId) {
      await db.delete(schema.zones).where(eq(schema.zones.zone_id, zoneId));
    },
    async deleteByCompany(companyId) {
      await db.delete(schema.zones).where(eq(schema.zones.company_id, companyId));
    },
  };

  return { sopTemplates, companyTemplates, officeLayouts, prefabInstances, zones };
}
