import { DEFAULT_COST_RATES, bindingStateChanged, installStateChanged } from '@offisim/core/browser';
import type { EventBus, InMemoryEventBus, RuntimeRepositories } from '@offisim/core/browser';
// Heavy imports — direct dist paths to bypass the @offisim/core barrel alias.
import { buildOffisimGraph } from '@offisim/core/dist/graph/main-graph.js';
import { createGateway } from '@offisim/core/dist/llm/gateway-factory.js';
import { ModelResolver } from '@offisim/core/dist/llm/model-resolver.js';
import { AuditingToolExecutor } from '@offisim/core/dist/mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '@offisim/core/dist/mcp/mcp-tool-executor.js';
import { createRuntimeContext } from '@offisim/core/dist/runtime/runtime-context.js';
import { MemoryService } from '@offisim/core/dist/services/memory-service.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import {
  buildSubscriptionGatewayConfig,
  createDesktopProviderGateway,
  getInstallEnvironmentForExecutionMode,
  resolveEffectiveRuntimePolicy,
} from '@offisim/ui-office';
import type { ProviderConfig } from '@offisim/ui-office';
import type { RuntimeBundle } from './browser-runtime';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { TauriMcpClientFactory } from './tauri-mcp-client';
import { createTauriRepositories } from './tauri-repos';
import { seedTauriDb } from './tauri-seed';

// ---------------------------------------------------------------------------
// Adapters: bridge @offisim/core repos + EventBus to @offisim/install-core DI
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

  const runtimePolicy = resolveEffectiveRuntimePolicy(
    config.runtimePolicy,
    config.provider,
    config.model,
    { tauri: true },
  );

  const modelResolver = new ModelResolver(runtimePolicy, {
    provider: runtimePolicy.modelPolicy.default.provider,
    model: runtimePolicy.modelPolicy.default.model,
    temperature: runtimePolicy.modelPolicy.default.temperature ?? 0.7,
    maxTokens: runtimePolicy.modelPolicy.default.maxTokens ?? 4096,
  });

  const checkpointer = new TauriCheckpointSaver();
  const graph = buildOffisimGraph({ checkpointer });

  // MCP tool executor — TauriMcpClientFactory supports both stdio (via Rust bridge) and SSE
  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId,
    clientFactory:
      runtimePolicy.executionMode === 'browser-limited'
        ? new BrowserMcpClientFactory()
        : new TauriMcpClientFactory(),
  });

  // Wrap with audit logging — writes to mcp_audit_log + emits mcp.tool.result events
  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    companyId,
    threadId,
  );
  const memoryService = runtimePolicy.memory.enabled
    ? new MemoryService(repos.memories, gateway, eventBus, {
        policy: runtimePolicy.memory,
      })
    : undefined;

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor,
    companyId,
    threadId,
    runtimePolicy,
    memoryService,
  });

  // Seed default cost rates (idempotent — skips if rates already exist)
  await seedCostRates(repos);

  // Install service — Drizzle-backed repos for persistent install state.
  // sqlite-proxy repos are async, so they intentionally do not expose the
  // synchronous transact() contract used by the better-sqlite3 runtime.
  const installService = new InstallService({
    repos: createInstallReposAdapter(repos),
    events: createEventEmitterAdapter(eventBus),
    companyId,
    environment: {
      runtimeVersion: '0.1.0',
      environment: getInstallEnvironmentForExecutionMode(runtimePolicy.executionMode),
      schemaVersion: '2026-03',
    },
    transact: undefined,
  });

  const { OrchestrationService } = await import(
    '@offisim/core/dist/services/orchestration-service.js'
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
