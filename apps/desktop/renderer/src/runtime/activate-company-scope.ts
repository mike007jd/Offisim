import type { SurfaceKey } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import type { RuntimeRepositories } from '@offisim/core/browser';
import { ensureCompanyWorkspaceProjectId } from './ensure-default-workspace.js';

export async function resolveCompanyScopeProjectId(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<string> {
  return (await ensureCompanyWorkspaceProjectId(repos, companyId)) ?? '';
}

export async function activateCompanyScope({
  companyId,
  setScope,
  setSurface,
  surface,
  shouldCommit,
}: {
  companyId: string;
  setScope: (companyId: string, projectId: string) => void;
  setSurface?: (surface: SurfaceKey) => void;
  surface?: SurfaceKey;
  shouldCommit?: () => boolean;
}): Promise<void> {
  const repos = await reposOrNull();
  let projectId = '';
  if (repos) {
    projectId = await resolveCompanyScopeProjectId(repos, companyId);
  }
  if (shouldCommit && !shouldCommit()) return;
  setScope(companyId, projectId);
  if (surface && setSurface) setSurface(surface);
}
