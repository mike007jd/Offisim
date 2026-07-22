import { isTauriRuntime } from '@/data/adapters.js';
import { aiAccountLaneKey } from '@/data/ai-model-presentation.js';
import { queryKeys } from '@/data/query-keys.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { serializeRuntimeExecutionSelector } from '@/runtime/execution-selection.js';
import { THINKING_LEVELS, type ThinkingLevel } from '@/runtime/pi-thread-thinking-store.js';
import { getRepos } from '@/runtime/repos.js';
import {
  type DurableThreadExecutionAuthority,
  resolveAuthoritativeThreadExecutionAuthority,
} from '@/runtime/thread-execution-authority.js';
import type {
  AiModelCatalogEntry,
  AiRuntimeStatus,
  RuntimeEngineCapabilityManifest,
} from '@offisim/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

/** One runnable model projected by the engine-neutral desktop runtime. */
export interface AgentRuntimeModelOption {
  selectionKind: 'api-model' | 'orchestration-engine';
  /** Adapter-private selector sent to the runtime; never shown to the user. */
  value: string;
  /** Friendly product label. */
  name: string;
  /** Account display name used to group choices. */
  accountName: string;
  accountId: string;
  engineId: string;
  modelId: string;
  billingMode: 'api' | 'subscription';
  source?: AiModelCatalogEntry['source'];
  availability: 'available' | 'expiring';
  availabilityReason?: string;
  expiresAt?: string;
  reasoning: boolean;
  reasoningEfforts: readonly ThinkingLevel[];
  defaultReasoningEffort?: ThinkingLevel;
  capabilities: RuntimeEngineCapabilityManifest;
}

const API_RUNTIME_CAPABILITIES: RuntimeEngineCapabilityManifest = {
  stop: true,
  steer: false,
  resume: true,
  attachmentInput: { textFiles: true, images: 'model-dependent' },
  permissionModes: ['plan', 'ask', 'auto', 'full'],
  interactions: { approval: true, userInput: true },
  processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
  interactionRoutes: {
    browser: [
      {
        id: 'offisim-browser',
        source: 'offisim-local',
        label: 'Offisim Browser',
        availability: 'available',
      },
    ],
    computer: [
      {
        id: 'offisim-computer',
        source: 'offisim-local',
        label: 'Offisim local driver',
        availability: 'runtime-determined',
      },
    ],
  },
};

function isRuntimeStatus(value: unknown): value is AiRuntimeStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiRuntimeStatus>;
  return (
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.models) &&
    Array.isArray(candidate.orchestrationEngines) &&
    typeof candidate.checkedAt === 'string'
  );
}

async function loadModels(): Promise<AgentRuntimeModelOption[]> {
  const rawStatus: unknown = await invokeCommand('agent_runtime_status', { includeUsage: false });
  if (!isRuntimeStatus(rawStatus)) {
    throw new Error('The desktop runtime returned an invalid model catalog.');
  }

  return projectRunnableModelOptions(rawStatus);
}

/** Safe picker projection: catalog rows are runnable only with a live executable account. */
function projectRunnableModelOptions(
  rawStatus: AiRuntimeStatus,
  nowMs = Date.now(),
): AgentRuntimeModelOption[] {
  const accountNames = new Map(
    rawStatus.accounts.map(
      (account) =>
        [
          aiAccountLaneKey(account.engineId, account.accountId, account.billingMode),
          account.displayName,
        ] as const,
    ),
  );
  const runnableAccounts = new Set(
    rawStatus.accounts
      .filter(
        (account) =>
          account.status === 'available' &&
          account.capabilities.execute.status === 'available' &&
          account.capabilities.models.status === 'available',
      )
      .map((account) => aiAccountLaneKey(account.engineId, account.accountId, account.billingMode)),
  );
  const apiModels: AgentRuntimeModelOption[] = rawStatus.models
    .filter(
      (model): model is AiModelCatalogEntry & { readonly availability: 'available' | 'expiring' } =>
        model.engineId === 'api' &&
        model.billingMode === 'api' &&
        (model.availability === 'available' ||
          (model.availability === 'expiring' &&
            Boolean(model.expiresAt) &&
            Number.isFinite(Date.parse(model.expiresAt ?? '')) &&
            Date.parse(model.expiresAt ?? '') > nowMs)) &&
        runnableAccounts.has(aiAccountLaneKey(model.engineId, model.accountId, model.billingMode)),
    )
    .map((model) => {
      const accountName =
        accountNames.get(aiAccountLaneKey(model.engineId, model.accountId, model.billingMode)) ??
        'API account';
      const exactReasoningEfforts = (model.reasoningEfforts ?? [])
        .map((effort) => effort.id)
        .filter((id): id is ThinkingLevel => Boolean(id && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id)))
        .filter((id, index, efforts) => efforts.indexOf(id) === index);
      const reasoningEfforts =
        exactReasoningEfforts.length > 0
          ? exactReasoningEfforts
          : model.engineId === 'api' && model.capabilities.reasoning
            ? THINKING_LEVELS
            : [];
      const defaultReasoningEffort = reasoningEfforts.find(
        (effort) => effort === model.defaultReasoningEffort,
      );
      return {
        selectionKind: 'api-model',
        value: serializeRuntimeExecutionSelector({
          kind: 'api-model',
          runtimeModelRef: model.runtimeModelRef,
        }),
        name: model.displayName,
        accountName,
        accountId: model.accountId,
        engineId: model.engineId,
        modelId: model.modelId,
        billingMode: model.billingMode,
        source: model.source,
        availability: model.availability,
        ...(model.availabilityReason ? { availabilityReason: model.availabilityReason } : {}),
        ...(model.expiresAt ? { expiresAt: model.expiresAt } : {}),
        reasoning: model.capabilities.reasoning,
        reasoningEfforts,
        ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        capabilities: API_RUNTIME_CAPABILITIES,
      };
    });

  const orchestrationEngines: AgentRuntimeModelOption[] = rawStatus.orchestrationEngines
    .filter((engine) => engine.state === 'ready')
    .map((engine) => ({
      selectionKind: 'orchestration-engine',
      value: serializeRuntimeExecutionSelector({
        kind: 'orchestration-engine',
        engineId: engine.engineId,
      }),
      name: engine.displayName,
      accountName: 'Orchestration engines',
      accountId: `${engine.engineId}:local`,
      engineId: engine.engineId,
      modelId: 'engine-managed',
      billingMode: 'subscription',
      availability: 'available',
      reasoning: false,
      reasoningEfforts: [],
      capabilities: engine.capabilities,
    }));

  return [...apiModels, ...orchestrationEngines];
}

async function loadThreadExecutionAuthority(
  threadId: string,
): Promise<DurableThreadExecutionAuthority | null> {
  const repos = await getRepos();
  const thread = await repos.chatThreads.findById(threadId);
  if (!thread) return null;
  const project = await repos.projects.findById(thread.project_id);
  if (!project) return null;
  return (
    resolveAuthoritativeThreadExecutionAuthority(
      await repos.agentRuns.findByThread(threadId),
      project.company_id,
    ) ?? null
  );
}

/** Runnable models from the engine-neutral runtime, cached for the desktop session. */
export function useAgentRuntimeModels() {
  const query = useQuery({
    queryKey: queryKeys.agentRuntimeModels(),
    queryFn: loadModels,
    enabled: isTauriRuntime(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [catalogClockMs, setCatalogClockMs] = useState(() => Date.now());
  const nextExpiryAt = useMemo(
    () =>
      query.data
        ?.filter((option) => option.availability === 'expiring')
        .map((option) => Date.parse(option.expiresAt ?? ''))
        .filter((expiry) => Number.isFinite(expiry) && expiry > catalogClockMs)
        .sort((left, right) => left - right)[0],
    [query.data, catalogClockMs],
  );
  useEffect(() => {
    if (nextExpiryAt === undefined) return;
    const delay = Math.min(Math.max(nextExpiryAt - Date.now() + 1, 1), 2_147_000_000);
    const timer = window.setTimeout(() => {
      setCatalogClockMs(Date.now());
      void query.refetch();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [nextExpiryAt, query.refetch]);

  const data = useMemo(
    () =>
      query.data?.filter(
        (option) =>
          option.availability === 'available' ||
          (Boolean(option.expiresAt) && Date.parse(option.expiresAt ?? '') > catalogClockMs),
      ),
    [query.data, catalogClockMs],
  );
  return { ...query, data };
}

/** Durable engine/account/selector binding for an already-started task. */
export function useThreadExecutionAuthority(threadId: string) {
  return useQuery({
    queryKey: queryKeys.agentRuntimeThreadAuthority(threadId),
    queryFn: () => loadThreadExecutionAuthority(threadId),
    enabled: isTauriRuntime() && Boolean(threadId),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data ? false : 1_000),
    retry: false,
  });
}
