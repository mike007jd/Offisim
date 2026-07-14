import { isTauriRuntime } from '@/data/adapters.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import type { AiModelCatalogEntry, AiRuntimeStatus } from '@offisim/shared-types';
import { useQuery } from '@tanstack/react-query';

/** One runnable model projected by the engine-neutral desktop runtime. */
export interface AgentRuntimeModelOption {
  /** Adapter-private selector sent to the runtime; never shown to the user. */
  value: string;
  /** Friendly product label. */
  name: string;
  /** Account display name used to group choices. */
  accountName: string;
  accountId: string;
  modelId: string;
  billingMode: 'api' | 'subscription';
  availability: 'available' | 'expiring';
  reasoning: boolean;
}

function isRuntimeStatus(value: unknown): value is AiRuntimeStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiRuntimeStatus>;
  return (
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.models) &&
    typeof candidate.checkedAt === 'string'
  );
}

async function loadModels(): Promise<AgentRuntimeModelOption[]> {
  const rawStatus: unknown = await invokeCommand('agent_runtime_status');
  if (!isRuntimeStatus(rawStatus)) {
    throw new Error('The desktop runtime returned an invalid model catalog.');
  }

  const accountNames = new Map(
    rawStatus.accounts.map((account) => [account.accountId, account.displayName] as const),
  );
  const options = rawStatus.models
    .filter(
      (model): model is AiModelCatalogEntry & { readonly availability: 'available' | 'expiring' } =>
        model.availability === 'available' || model.availability === 'expiring',
    )
    .map((model) => {
      const accountName = accountNames.get(model.accountId) ?? 'AI account';
      return {
        value: model.runtimeModelRef,
        name: model.displayName,
        accountName,
        accountId: model.accountId,
        modelId: model.modelId,
        billingMode: model.billingMode,
        availability: model.availability,
        reasoning: model.capabilities.reasoning,
      };
    });

  // The runtime catalog is the only source of runnable models. Stale
  // per-conversation picks are removed; no hidden global model override is
  // allowed to compete with the conversation selection.
  usePiThreadModelStore.getState().pruneInvalidModels(options.map((option) => option.value));
  return options;
}

/** Runnable models from the engine-neutral runtime, cached for the desktop session. */
export function useAgentRuntimeModels() {
  return useQuery({
    queryKey: ['agent-runtime', 'models'],
    queryFn: loadModels,
    enabled: isTauriRuntime(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
