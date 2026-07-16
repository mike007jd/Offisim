import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  activateCompanyScope,
  beginCompanyScopeActivation,
  invalidateCompanyScopeActivation,
} from './activate-company-scope.js';
import { missionRunManager } from './mission/mission-run-manager.js';

/**
 * On the real desktop backend, pre-select the first company/project from SQLite
 * so a user who picks "Enter" from the lifecycle front door lands in a populated
 * scope. The landing surface is the lifecycle front door (ui-state default), so
 * this never forces a surface. No-op only in a non-Tauri preview; release
 * repository failures must be visible.
 */
export function useRealDataBootstrap(): void {
  const setScope = useUiState((s) => s.setScope);

  useEffect(() => {
    let cancelled = false;
    // Claim the automatic intent before the first repository await. Any later
    // explicit company activation receives a newer id and wins.
    const activationId = beginCompanyScopeActivation();
    const unsubscribeScope = useUiState.subscribe((state, previous) => {
      if (state.companyId !== previous.companyId) invalidateCompanyScopeActivation();
    });
    (async () => {
      const repos = await reposOrNull();
      if (!repos || cancelled) return;
      const companies = await repos.companies.findAll();
      // Recovery safety is independent of which companies remain selectable.
      // An archived company can still have owned native work if it was archived
      // while a Mission was running, so every persisted company participates.
      await missionRunManager.bootstrapAllRendererReload(
        companies.map((company) => company.company_id),
      );
      if (cancelled) return;
      const company = companies.find((candidate) => candidate.status !== 'archived');
      if (!company) return;
      await activateCompanyScope({
        companyId: company.company_id,
        setScope,
        activationId,
        shouldCommit: () => !cancelled && useUiState.getState().companyId === '',
      });
    })().catch((error: unknown) => {
      console.error('[offisim] desktop repository bootstrap failed', error);
      toast.error('Desktop data source unavailable', {
        description: error instanceof Error ? error.message : 'Repository initialization failed.',
      });
    });
    return () => {
      cancelled = true;
      invalidateCompanyScopeActivation();
      unsubscribeScope();
    };
  }, [setScope]);
}
