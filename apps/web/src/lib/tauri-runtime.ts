import { DEFAULT_COST_RATES, bindingStateChanged, installStateChanged } from '@aics/core/browser';
import type { EventBus, InMemoryEventBus, RuntimeRepositories } from '@aics/core/browser';
// Heavy imports — direct dist paths to bypass the @aics/core barrel alias.
import { buildAicsGraph } from '@aics/core/dist/graph/main-graph.js';
import { createGateway } from '@aics/core/dist/llm/gateway-factory.js';
import { ModelResolver } from '@aics/core/dist/llm/model-resolver.js';
import { AuditingToolExecutor } from '@aics/core/dist/mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '@aics/core/dist/mcp/mcp-tool-executor.js';
import { createRuntimeContext } from '@aics/core/dist/runtime/runtime-context.js';
import { InstallService } from '@aics/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@aics/install-core';
import { buildSubscriptionGatewayConfig, createDesktopProviderGateway } from '@aics/ui-office';
import type { ProviderConfig } from '@aics/ui-office';
import type { RuntimeBundle } from './browser-runtime';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { TauriMcpClientFactory } from './tauri-mcp-client';
import { createTauriRepositories } from './tauri-repos';
import { seedTauriDb } from './tauri-seed';

// ---------------------------------------------------------------------------
// Adapters: bridge @aics/core repos + EventBus to @aics/install-core DI
// ---------------------------------------------------------------------------

/** Adapts RuntimeRepositories to InstallRepositories (structurally identical). */
function createInstallReposAdapter(repos: RuntimeRepositories): InstallRepositories {
  return {
    installTransactions: repos.installTransactions,
    installedPackages: repos.installedPackages,
    installedAssets: repos.installedAssets,
    assetBindings: repos.assetBindings,
    employees: repos.employees,
  };
}

/** Adapts the core EventBus to InstallEventEmitter. */
function createEventEmitterAdapter(eventBus: EventBus): InstallEventEmitter {
  return {
    emitInstallState(companyId, txnId, prev, next, packageId, errorCode) {
      eventBus.emit(
        installStateChanged(companyId, txnId, prev, next, undefined, packageId, errorCode),
      );
    },
    emitBindingState(companyId, bindingId, txnId, type, key, prev, next) {
      eventBus.emit(bindingStateChanged(companyId, bindingId, txnId, type, key, prev, next));
    },
  };
}

/**
 * Create the full runtime stack for Tauri desktop mode.
 *
 * Differences from browser mode:
 * 1. Repos: Drizzle sqlite-proxy → persistent SQLite (not memory)
 * 2. Checkpointer: TauriCheckpointSaver → persistent (not MemorySaver)
 * 3. Gateway: Direct API calls, no Vite proxy (tauri-plugin-cors-fetch handles CORS)
 * 4. DB seed: Run once on first launch
 *
 * @param config - Provider configuration (API key, model, etc.)
 * @param eventBus - Shared EventBus instance from the Provider. Using a shared
 *   bus avoids the "EventBus churn" problem where async init would create a
 *   different bus than what UI hooks subscribe to.
 */
export async function createTauriRuntime(
  config: ProviderConfig,
  eventBus: InMemoryEventBus,
  companyId: string,
): Promise<RuntimeBundle> {
  const threadId = `thread-${companyId}`;
  await seedTauriDb();

  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);

  // No proxy needed — tauri-plugin-cors-fetch hooks fetch() transparently
  const gateway =
    config.provider === 'subscription'
      ? createGateway({
          provider: config.provider,
          apiKey: '',
          baseURL: config.baseURL,
          defaultHeaders: config.defaultHeaders,
          dangerouslyAllowBrowser: true,
          subscription: buildSubscriptionGatewayConfig(config),
        })
      : createDesktopProviderGateway(config);

  const modelResolver = new ModelResolver(null, {
    provider: config.provider,
    model: config.model,
    temperature: 0.7,
    maxTokens: 4096,
  });

  const checkpointer = new TauriCheckpointSaver();
  const graph = buildAicsGraph({ checkpointer });

  // MCP tool executor — TauriMcpClientFactory supports both stdio (via Rust bridge) and SSE
  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId,
    clientFactory: new TauriMcpClientFactory(),
  });

  // Wrap with audit logging — writes to mcp_audit_log + emits mcp.tool.result events
  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    companyId,
    threadId,
  );

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor,
    companyId,
    threadId,
  });

  // Seed default cost rates (idempotent — skips if rates already exist)
  await seedCostRates(repos);

  // Install service — Drizzle-backed repos for persistent install state.
  // Pass repos.transact so materialize() wraps all writes in one SQLite transaction.
  const installService = new InstallService({
    repos: createInstallReposAdapter(repos),
    events: createEventEmitterAdapter(eventBus),
    companyId,
    environment: {
      runtimeVersion: '0.1.0',
      environment: 'desktop',
      schemaVersion: '2026-03',
    },
    transact: repos.transact,
  });

  const { OrchestrationService } = await import(
    '@aics/core/dist/services/orchestration-service.js'
  );
  const orch = new OrchestrationService(graph, runtimeCtx);

  return { eventBus, graph, runtimeCtx, orch, installService, mcpToolExecutor, repos };
}

/**
 * Seed default LLM cost rates into the Tauri runtime's persistent DB.
 * Idempotent: skips if rates already exist.
 */
async function seedCostRates(repos: RuntimeRepositories): Promise<void> {
  const existing = await repos.costRates.findAll();
  if (existing.length > 0) return;

  const today = new Date().toISOString().slice(0, 10);
  for (const rate of DEFAULT_COST_RATES) {
    await repos.costRates.create({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: today,
      effective_until: null,
    });
  }
}
