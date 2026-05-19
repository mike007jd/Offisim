/**
 * Lightweight Tauri runtime: SQLite repos + EventBus only, no LLM/graph.
 *
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key. Data persists to SQLite so it
 * survives reinitRuntime() calls.
 */
import {
  DeliverablePersistenceService,
  SkillLoader,
  marketListingInstalled,
} from '@offisim/core/browser';
import type { InMemoryEventBus } from '@offisim/core/browser';
import {
  HookRegistry,
  Scratchpad,
  createRuntimeContext,
  ensureYoloMasterForActiveCompanies,
} from '@offisim/core/runtime';
import { InteractionService } from '@offisim/core/services';
import type { InteractionMode } from '@offisim/shared-types';
import { installAttachmentDeleteCascades } from './attachment-cascades';
import type { RuntimeBundle } from './runtime-bundle';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { TauriAttachmentStore } from './tauri-attachment-store';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { tryActivateTauriVault } from './vault-tauri-activation';

export async function createTauriRuntimeReposOnly(
  eventBus: InMemoryEventBus,
  companyId?: string,
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle> {
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db, eventBus);
  const runtimeCompanyId = companyId ?? 'company-bootstrap';
  const threadId = `thread-${runtimeCompanyId}`;
  const attachmentStore = new TauriAttachmentStore();
  installAttachmentDeleteCascades({ repos, attachmentStore, eventBus });
  await ensureYoloMasterForActiveCompanies(repos);
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });

  await seedDefaultCostRatesIfEmpty(repos);

  // Vault is LLM-independent; activate it so employee markdown lands on disk
  // even without a provider key. Skipped in the pre-company Bootstrap stage.
  const vaultActivation = companyId
    ? await tryActivateTauriVault({ eventBus, repos, companyId })
    : null;
  const skillLoader = SkillLoader.forRepos(repos, {
    emitMarketListingInstalled(cid, listingId, kind, extras) {
      eventBus.emit(marketListingInstalled(cid, listingId, kind, extras));
    },
  });
  if (vaultActivation && skillLoader) {
    skillLoader.setFs(vaultActivation.fs);
  }

  const interactionBox = { pending: null };
  const hookRegistry = new HookRegistry();
  const scratchpad = new Scratchpad();
  const interactionService = new InteractionService({
    eventBus,
    companyId: runtimeCompanyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
    hookRegistry,
  });
  await interactionService.restore();

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: createRuntimeContext({
      repos,
      eventBus,
      llmGateway: null as never,
      modelResolver: null as never,
      toolExecutor: {
        execute: async () => ({ success: false, result: null }),
        listAvailable: async () => [],
      },
      companyId: runtimeCompanyId,
      threadId,
      interactionBox,
      hookRegistry,
      scratchpad,
      interactionService,
      attachmentStoreBridge: attachmentStore,
      ...(skillLoader ? { skillLoader } : {}),
    }),
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    skillLoader,
    interactionService,
    vaultActivation: vaultActivation ?? undefined,
    desktopVaultRoot: vaultActivation?.root ?? null,
    attachmentStore,
    dispose: () => {
      deliverablePersistence.dispose();
      vaultActivation?.dispose();
    },
  };
}
