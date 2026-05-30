import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import { CompanyTemplateService } from '@offisim/core/browser';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CompanyCreationWizard,
  type CreateCompanyRequest,
} from './CompanyCreationWizard.js';
import { CompanySelectionPage } from './CompanySelectionPage.js';

type LifecycleMode = 'portal' | 'create';

/** Lifecycle surface root — level-0 full-screen takeover (rendered outside the
 *  AppFrame, so no topbar/nav chrome). Switches between the company-selection
 *  portal (default) and the company-creation wizard. */
export function LifecycleSurface() {
  const setCompany = useUiState((s) => s.setCompany);
  const setSurface = useUiState((s) => s.setSurface);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<LifecycleMode>('portal');

  async function createCompany(request: CreateCompanyRequest) {
    const repos = await reposOrNull();
    if (!repos) {
      throw new Error('Company storage is unavailable in this runtime.');
    }

    const companyId = crypto.randomUUID();
    const now = new Date().toISOString();
    const isCustom = request.template.id === 'create-your-own';

    await repos.companies.create({
      company_id: companyId,
      name: request.name,
      status: 'active',
      template_id: isCustom ? null : request.template.id,
      template_label: isCustom ? 'Custom Studio' : request.template.name,
      workspace_root: null,
      description_json: null,
      created_at: now,
      updated_at: now,
    });

    // The company row now exists. The remaining steps (event emit + template
    // materialization) write additional company-scoped rows non-atomically, so a
    // partial failure here would orphan the company. On any failure, delete the
    // company row — every company-scoped child (the created event, employees,
    // office layout, zones, prefab instances) is FK `ON DELETE CASCADE`, so the
    // delete rolls the whole create back — then rethrow so the user sees it.
    try {
      await repos.events.insert({
        event_id: crypto.randomUUID(),
        company_id: companyId,
        thread_id: null,
        event_type: 'company.created',
        severity: 'info',
        payload_json: JSON.stringify({
          name: request.name,
          templateId: isCustom ? null : request.template.id,
          templateLabel: isCustom ? 'Custom Studio' : request.template.name,
          description: request.description,
          destination: request.openStudio ? 'studio' : 'office',
        }),
        created_at: now,
      });

      if (!isCustom) {
        const templateService = new CompanyTemplateService(
          repos.employees,
          repos.officeLayouts,
          runtimeEventBus,
          repos.prefabInstances,
          undefined,
          repos.zones,
        );
        await templateService.materializeTemplate(request.template.id, companyId);
      }
    } catch (error) {
      try {
        await repos.companies.delete(companyId);
      } catch {
        // Best-effort compensation; surface the original create failure below.
      }
      throw error;
    }

    await queryClient.invalidateQueries({ queryKey: ['companies'] });
    await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });

    setCompany(companyId);
    setMode('portal');
    setSurface(request.openStudio ? 'studio' : 'office');

    toast.success(`Created ${request.name}`, {
      description: request.openStudio
        ? 'Studio opened on a real company workspace.'
        : 'Employees, zones, and office layout were persisted.',
    });
  }

  if (mode === 'create') {
    return (
      <CompanyCreationWizard
        onDismiss={() => setMode('portal')}
        onComplete={createCompany}
      />
    );
  }

  return <CompanySelectionPage onNewCompany={() => setMode('create')} />;
}
