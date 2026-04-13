import { type CompanyTemplate, CompanyTemplateService, listTemplates } from '@offisim/core/browser';
import { isTauri, useOffisimRuntime } from '@offisim/ui-office/web';
import { useEffect, useRef } from 'react';
import { runVaultDevSmoke } from './vault-dev-smoke';

const AUTO_SMOKE_FLAG = import.meta.env.VITE_OFFISIM_AUTO_SMOKE;
export const AUTO_SMOKE_REPORT_FILENAME = 'dev-auto-smoke-report.json';

type AutoSmokeTemplateLike = Pick<CompanyTemplate, 'id' | 'name'>;

export function isDevAutoSmokeEnabled(options?: {
  dev?: boolean;
  tauri?: boolean;
  flag?: string | undefined;
}): boolean {
  return (
    (options?.dev ?? import.meta.env.DEV) &&
    (options?.tauri ?? isTauri()) &&
    (options?.flag ?? AUTO_SMOKE_FLAG) === '1'
  );
}

export function getAutoSmokeTemplate<T extends AutoSmokeTemplateLike>(
  templates: readonly T[],
): T | null {
  return templates.find((template) => template.id === 'rd-company') ?? templates[0] ?? null;
}

async function writeAutoSmokeReport(report: Record<string, unknown>): Promise<void> {
  const [{ appDataDir }, fsMod] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const root = (await appDataDir()).replace(/\/+$/u, '');
  await fsMod.writeTextFile(
    `${root}/${AUTO_SMOKE_REPORT_FILENAME}`,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    ),
  );
}

export function DevAutoSmokeBootstrap({
  onCompanyCreated,
}: {
  onCompanyCreated: (companyId: string) => void;
}) {
  const { repos, eventBus, isReady } = useOffisimRuntime();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isDevAutoSmokeEnabled() || !isReady || !repos || ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        const template = getAutoSmokeTemplate(listTemplates());
        if (!template) {
          throw new Error('No built-in company templates available for auto smoke.');
        }
        const companyId = crypto.randomUUID();
        const now = new Date().toISOString();
        await repos.companies.create({
          company_id: companyId,
          name: '__AUTO_SMOKE__',
          status: 'active',
          template_id: template.id,
          template_label: template.name,
          workspace_root: null,
          default_model_policy_json: null,
          created_at: now,
          updated_at: now,
        });
        const service = new CompanyTemplateService(
          repos.employees,
          repos.sopTemplates,
          repos.officeLayouts,
          eventBus,
          repos.prefabInstances,
          undefined,
          repos.zones,
        );
        await service.materializeTemplate(template.id, companyId);
        onCompanyCreated(companyId);
      } catch (error) {
        await writeAutoSmokeReport({
          phase: 'bootstrap',
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [eventBus, isReady, onCompanyCreated, repos]);

  return null;
}

export function useDevAutoSmokeRunner(params: {
  companyId: string;
  eventBus: Parameters<typeof runVaultDevSmoke>[0]['eventBus'];
  runtime: Parameters<typeof runVaultDevSmoke>[0]['runtime'];
}): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isDevAutoSmokeEnabled() || !params.runtime || ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        const result = await runVaultDevSmoke(params);
        await writeAutoSmokeReport({
          phase: 'smoke',
          companyId: params.companyId,
          result,
        });
      } catch (error) {
        await writeAutoSmokeReport({
          phase: 'smoke',
          ok: false,
          companyId: params.companyId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [params]);
}
