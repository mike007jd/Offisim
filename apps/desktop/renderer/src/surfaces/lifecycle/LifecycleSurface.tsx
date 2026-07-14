import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { deleteCompanyDeep } from '@/data/local-data-deletion.js';
import { useCompanies } from '@/data/queries.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { activateCompanyScope } from '@/runtime/activate-company-scope.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import { ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { CompanyTemplateService } from '@offisim/core/browser';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { CompanyCreationWizard, type CreateCompanyRequest } from './CompanyCreationWizard.js';
import { CompanySelectionPage } from './CompanySelectionPage.js';

type LifecycleMode = 'portal' | 'create';

/** Lifecycle surface root — level-0 full-screen takeover (rendered outside the
 *  AppFrame, so no topbar/nav chrome). This is the product front door: with no
 *  companies it opens the creation wizard directly; with one or more it opens
 *  the selection page. A user action (new / dismiss) overrides the derived mode. */
export function LifecycleSurface() {
  const setScope = useUiState((s) => s.setScope);
  const setSurface = useUiState((s) => s.setSurface);
  const intent = useUiState((s) => s.lifecycleIntent);
  const queryClient = useQueryClient();
  const companies = useCompanies();
  // In-page toggles (wizard dismiss / selection "Create") win over the entry
  // intent, which in turn wins over the count-derived default.
  const [override, setOverride] = useState<LifecycleMode | null>(null);

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
    // materialization + workspace) write additional company-scoped rows
    // non-atomically (the async Tauri backend has no single transaction across
    // them), so a partial failure would orphan the company. C3: on any failure,
    // roll the WHOLE company back with the deep delete below.
    let projectId = '';
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
          repos.workstations,
        );
        await templateService.materializeTemplate(request.template.id, companyId, {
          employeeModels: request.employeeModels,
        });
      }

      const projectWorkspaceRoot = request.workspaceRoot?.trim() || null;
      if (projectWorkspaceRoot) {
        if (!request.workspaceSelectionRef) {
          throw new Error('Project folder selection expired. Choose the folder again.');
        }
        projectId = crypto.randomUUID();
        await invokeCommand('project_create', {
          input: {
            projectId,
            companyId,
            name: 'Main Project',
            description: request.description,
            status: 'planning',
            workspaceSelectionRef: request.workspaceSelectionRef,
            verifyCommand: null,
            verifyMaxAttempts: 3,
            verifyTokenBudget: null,
          },
        });
      }
    } catch (error) {
      // C3 compensation (saga): roll the whole company back with the deep delete
      // (explicit multi-table delete + workspace + attachments), not just the
      // companies row — so it does not depend on FK cascade being enabled on the
      // connection. A compensation FAILURE is surfaced, not swallowed, so a
      // half-created company never passes silently.
      try {
        await deleteCompanyDeep(companyId);
      } catch (cleanupError) {
        throw new Error(
          `Company creation failed and rollback also failed for ${companyId} (manual cleanup may be needed). Create error: ${errorDetail(error, 'unknown error')}. Rollback error: ${errorDetail(cleanupError, 'unknown error')}`,
        );
      }
      throw error;
    }

    await queryClient.invalidateQueries({ queryKey: ['companies'] });
    await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
    await queryClient.invalidateQueries({ queryKey: ['projects', companyId] });

    await activateCompanyScope({
      companyId,
      setScope,
      setSurface,
      surface: request.openStudio ? 'studio' : 'office',
    });
    setOverride('portal');

    toast.success(`${request.name} created.`);
  }

  // Don't flash the wrong front door before the company count resolves.
  if (companies.isLoading) {
    return (
      <output className="off-lc-boot" aria-busy="true">
        <div className="off-lc-boot-panel">
          <div className="off-lc-boot-mark" />
          <div>
            <div className="off-lc-boot-title">Loading Offisim</div>
            <div className="off-lc-boot-copy">Opening the local company workspace.</div>
          </div>
        </div>
      </output>
    );
  }
  // A read failure must NOT collapse into the empty-account 'create' path — a
  // user who actually has companies would otherwise be dropped into the wizard
  // and could author a duplicate. Show an honest load-failure with Retry.
  if (companies.isError) {
    return (
      <div className="off-lc-error-wrap" role="alert">
        <ErrorState
          title="Couldn't load your companies"
          detail={errorDetail(companies.error, 'Local data is temporarily unavailable.')}
          onRetry={() => void companies.refetch()}
        />
      </div>
    );
  }
  const hasCompanies = (companies.data?.length ?? 0) > 0;
  const intentMode: LifecycleMode | null =
    intent === 'create' ? 'create' : intent === 'select' ? 'portal' : null;
  const mode: LifecycleMode = override ?? intentMode ?? (hasCompanies ? 'portal' : 'create');

  if (mode === 'create') {
    return (
      <CompanyCreationWizard
        dismissible={hasCompanies}
        onDismiss={() => setOverride('portal')}
        onComplete={createCompany}
      />
    );
  }

  return <CompanySelectionPage onNewCompany={() => setOverride('create')} />;
}
