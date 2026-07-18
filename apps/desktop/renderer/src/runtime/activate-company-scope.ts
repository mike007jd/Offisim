import { type SurfaceKey, guardCurrentSurfaceScopeChange, useUiState } from '@/app/ui-state.js';
import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { reposOrNull } from '@/data/adapters.js';
import type { RuntimeRepositories } from '@offisim/core/browser';
import { missionRunManager } from './mission/mission-run-manager.js';

let currentCompanyScopeActivation = 0;

/** Start a globally ordered company-scope intent. The newest user action wins
 * even when an older company's Mission recovery takes several seconds. */
export function beginCompanyScopeActivation(): number {
  currentCompanyScopeActivation += 1;
  return currentCompanyScopeActivation;
}

/** Supersede an in-flight activation when scope changed outside this helper. */
export function invalidateCompanyScopeActivation(): void {
  currentCompanyScopeActivation += 1;
}

/** Shared production commit gate; exported so the deterministic harness tests
 * the exact intent ordering used by every company activation caller. */
export function commitCompanyScopeActivation(
  activationId: number,
  canCommit: () => boolean,
  operation: () => void,
): boolean {
  if (activationId !== currentCompanyScopeActivation || !canCommit()) return false;
  operation();
  return true;
}

async function resolveCompanyScopeProjectId(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<string> {
  const company = await repos.companies.findById(companyId);
  if (!company) throw new Error(`Company ${companyId} not found.`);
  const projects = await repos.projects.findByCompany(companyId);
  return projects[0]?.project_id ?? '';
}

/** Finish both native-run recovery lanes before exposing a company scope. Mission
 * recovery runs first because Conversation bootstrap must not claim Mission-owned
 * roots. An incomplete Conversation pass is retryable and never commits the UI. */
export async function bootstrapCompanyScopeRuns(
  companyId: string,
  companyIds: readonly string[],
  bootstrapMissions: (companyIds: readonly string[]) => Promise<unknown> = (ids) =>
    missionRunManager.bootstrapAllRendererReload(ids),
  bootstrapConversations: (companyId: string) => Promise<{ complete: boolean }> = (id) =>
    conversationRunController.bootstrapLiveRuns(id),
): Promise<void> {
  await bootstrapMissions(companyIds);
  const conversationBootstrap = await bootstrapConversations(companyId);
  if (!conversationBootstrap.complete) {
    throw new Error("Offisim is still reconnecting this company's work. Try again in a moment.");
  }
}

export async function activateCompanyScope({
  companyId,
  setScope,
  setSurface,
  surface,
  shouldCommit,
  activationId: providedActivationId,
}: {
  companyId: string;
  setScope: (companyId: string, projectId: string) => void;
  setSurface?: (surface: SurfaceKey) => void;
  surface?: SurfaceKey;
  shouldCommit?: () => boolean;
  /** Reserved for automatic bootstrap, which must claim its intent before its
   * first repository await so a later user selection always supersedes it. */
  activationId?: number;
}): Promise<boolean> {
  const activationId = providedActivationId ?? beginCompanyScopeActivation();
  const repos = await reposOrNull();
  let projectId = '';
  if (repos) {
    // A fast click on the lifecycle portal can race the app-wide bootstrap.
    // Share all per-company convergence promises and do not expose any company
    // to Conversation recovery until every active Mission root is parked.
    const allCompanies = await repos.companies.findAll();
    const activeCompanies = allCompanies.filter((company) => company.status !== 'archived');
    if (!activeCompanies.some((company) => company.company_id === companyId)) {
      throw new Error(`Company ${companyId} is not active.`);
    }
    await bootstrapCompanyScopeRuns(
      companyId,
      allCompanies.map((company) => company.company_id),
    );
    projectId = await resolveCompanyScopeProjectId(repos, companyId);
  }
  const canCommit = () => shouldCommit?.() ?? true;
  let currentIntent = false;
  commitCompanyScopeActivation(activationId, canCommit, () => {
    currentIntent = true;
  });
  if (!currentIntent) return false;

  let committed = false;
  const targetSurface = surface ?? useUiState.getState().surface;
  const allowed = await guardCurrentSurfaceScopeChange(targetSurface, () => {
    // The user may leave a discard dialog open while choosing another
    // company. Re-check intent ordering at the actual commit boundary.
    committed = commitCompanyScopeActivation(activationId, canCommit, () => {
      setScope(companyId, projectId);
      if (surface && setSurface) setSurface(surface);
    });
  });
  return allowed && committed;
}
