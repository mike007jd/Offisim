import type {
  AiExecutionTarget,
  AiModelCatalogEntry,
  AiRuntimeStatus,
  OrchestrationEngineStatus,
} from '@offisim/shared-types';
import { isSameModelSource, validateExecutionTarget } from './execution-provenance.js';
import type { PiAgentHostEvent } from './pi-runtime-driver.js';

export function hostModelRef(
  model: Extract<PiAgentHostEvent, { kind: 'started' }>['model'],
): string | null {
  if (model?.api === 'codex-app-server' && model.catalogId?.trim()) {
    return `codex:${model.catalogId.trim()}`;
  }
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export interface ResolvedApiExecutionSelection {
  readonly target: AiExecutionTarget;
  readonly runtimeModelRef: string;
}

export type ResolvedRuntimeExecutionSelection = ResolvedApiExecutionSelection;

export type RuntimeExecutionSelector =
  | { readonly kind: 'api-model'; readonly runtimeModelRef: string }
  | {
      readonly kind: 'orchestration-engine';
      readonly engineId: string;
      readonly modelId?: string;
    };

export const MODEL_PASSTHROUGH_ENGINES: ReadonlySet<string> = new Set(['codex']);

const ENGINE_MANAGED_MODEL_ID = 'engine-managed';

export function serializeRuntimeExecutionSelector(selector: RuntimeExecutionSelector): string {
  if (selector.kind === 'api-model') {
    const runtimeModelRef = selector.runtimeModelRef.trim();
    if (!runtimeModelRef) throw new Error('AI execution selectors require a non-empty value.');
    return `${selector.kind}:${runtimeModelRef}`;
  }
  const engineId = selector.engineId.trim();
  const modelId = selector.modelId?.trim();
  if (!engineId || engineId.includes(':') || (selector.modelId !== undefined && !modelId)) {
    throw new Error('Orchestration selectors require a valid engine and model.');
  }
  return modelId && modelId !== ENGINE_MANAGED_MODEL_ID
    ? `${selector.kind}:${engineId}:${modelId}`
    : `${selector.kind}:${engineId}`;
}

export function parseRuntimeExecutionSelector(
  value: string | undefined,
): RuntimeExecutionSelector | undefined {
  const encoded = value?.trim();
  if (!encoded) return undefined;
  const apiPrefix = 'api-model:';
  if (encoded.startsWith(apiPrefix) && encoded.length > apiPrefix.length) {
    return { kind: 'api-model', runtimeModelRef: encoded.slice(apiPrefix.length) };
  }
  const enginePrefix = 'orchestration-engine:';
  if (encoded.startsWith(enginePrefix) && encoded.length > enginePrefix.length) {
    const value = encoded.slice(enginePrefix.length);
    const separator = value.indexOf(':');
    const engineId = (separator < 0 ? value : value.slice(0, separator)).trim();
    const modelId = separator < 0 ? undefined : value.slice(separator + 1).trim();
    if (!engineId || engineId.includes(':') || (separator >= 0 && !modelId)) {
      throw new Error('The saved AI selector is invalid. Choose an engine or model again.');
    }
    return {
      kind: 'orchestration-engine',
      engineId,
      ...(modelId ? { modelId } : {}),
    };
  }
  throw new Error('The saved AI selector is invalid. Choose an engine or model again.');
}

export function isSameExecutionTarget(
  expected: AiExecutionTarget | null | undefined,
  actual: AiExecutionTarget | null | undefined,
): boolean {
  return Boolean(
    expected &&
      actual &&
      expected.engineId === actual.engineId &&
      expected.accountId === actual.accountId &&
      expected.billingMode === actual.billingMode &&
      expected.modelId === actual.modelId &&
      isSameModelSource(expected.modelSource, actual.modelSource),
  );
}

function availableApiModel(status: AiRuntimeStatus, model: AiModelCatalogEntry): boolean {
  const account = status.accounts.find(
    (candidate) => candidate.engineId === model.engineId && candidate.accountId === model.accountId,
  );
  return Boolean(
    model.engineId === 'api' &&
      model.billingMode === 'api' &&
      model.runtimeModelRef.trim() &&
      model.modelId.trim() &&
      (model.availability === 'available' ||
        (model.availability === 'expiring' &&
          model.expiresAt &&
          Date.parse(model.expiresAt) > Date.now())) &&
      account?.billingMode === 'api' &&
      account.status === 'available' &&
      account.capabilities.execute.status === 'available' &&
      account.capabilities.models.status === 'available',
  );
}

function orchestrationExecutionTarget(
  engineId: string,
  modelId = ENGINE_MANAGED_MODEL_ID,
): AiExecutionTarget {
  return {
    engineId,
    accountId: `${engineId}:local`,
    billingMode: 'subscription',
    modelId,
    modelSource: { kind: 'native' },
  };
}

function orchestrationRuntimeModelRef(engineId: string, modelId: string): string {
  return modelId === ENGINE_MANAGED_MODEL_ID ? engineId : `${engineId}:${modelId}`;
}

function readyOrchestrationEngine(
  status: AiRuntimeStatus,
  engineId: string,
): OrchestrationEngineStatus | undefined {
  return status.orchestrationEngines.find(
    (engine) => engine.engineId === engineId && engine.state === 'ready',
  );
}

function isDeclaredOrchestrationModel(engine: OrchestrationEngineStatus, modelId: string): boolean {
  return Boolean(engine.runOptions?.models.some((model) => model.id === modelId));
}

function isCanonicalOrchestrationTarget(
  target: AiExecutionTarget,
  engine: OrchestrationEngineStatus,
): boolean {
  return (
    isSameExecutionTarget(target, orchestrationExecutionTarget(target.engineId, target.modelId)) &&
    (target.modelId === ENGINE_MANAGED_MODEL_ID ||
      isDeclaredOrchestrationModel(engine, target.modelId))
  );
}

/** Resolve one globally unique model/account/engine before the gateway crosses
 * into an adapter. Exact model ids are accepted only when they identify one
 * catalog row; adapter-private runtime refs remain the unambiguous selector. */
export function resolveRuntimeExecutionSelection(
  statusValue: unknown,
  requestedSelection: RuntimeExecutionSelector | undefined,
  frozenTarget: AiExecutionTarget | undefined,
  frozenRuntimeModelRef?: string,
): ResolvedRuntimeExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (
    !Array.isArray(status.accounts) ||
    !Array.isArray(status.models) ||
    !Array.isArray(status.orchestrationEngines)
  ) {
    throw new Error('AI Accounts status is unavailable. Check the selected account.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts,
    models: status.models,
    orchestrationEngines: status.orchestrationEngines,
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const apiCandidates = runtimeStatus.models.filter((model) =>
    availableApiModel(runtimeStatus, model),
  );
  if (frozenTarget) {
    const validTarget = validateExecutionTarget(frozenTarget);
    if (!validTarget) throw new Error('This task does not have a valid execution target.');
    const frozenEngine = readyOrchestrationEngine(runtimeStatus, validTarget.engineId);
    if (frozenEngine) {
      if (
        validTarget.modelId !== ENGINE_MANAGED_MODEL_ID &&
        !isDeclaredOrchestrationModel(frozenEngine, validTarget.modelId)
      ) {
        throw new Error("The task's saved model is no longer available.");
      }
      const frozenModelId = validTarget.modelId;
      const expectedRuntimeModelRef = orchestrationRuntimeModelRef(
        frozenEngine.engineId,
        frozenModelId,
      );
      const requestedModelId =
        requestedSelection?.kind === 'orchestration-engine'
          ? requestedSelection.modelId?.trim() || ENGINE_MANAGED_MODEL_ID
          : undefined;
      if (
        !isCanonicalOrchestrationTarget(validTarget, frozenEngine) ||
        frozenRuntimeModelRef?.trim() !== expectedRuntimeModelRef ||
        (requestedSelection &&
          (requestedSelection.kind !== 'orchestration-engine' ||
            requestedSelection.engineId !== frozenEngine.engineId ||
            requestedModelId !== frozenModelId))
      ) {
        throw new Error("The task's saved orchestration engine is no longer available.");
      }
      return {
        target: orchestrationExecutionTarget(frozenEngine.engineId, frozenModelId),
        runtimeModelRef: expectedRuntimeModelRef,
      };
    }
    const frozenSelector = frozenRuntimeModelRef?.trim();
    const matches = apiCandidates.filter(
      (model) =>
        model.engineId === validTarget.engineId &&
        model.accountId === validTarget.accountId &&
        model.billingMode === validTarget.billingMode &&
        model.modelId === validTarget.modelId &&
        (!frozenSelector || model.runtimeModelRef === frozenSelector) &&
        (!requestedSelection ||
          (requestedSelection.kind === 'api-model' &&
            requestedSelection.runtimeModelRef === model.runtimeModelRef)),
    );
    if (matches.length !== 1) {
      throw new Error("The task's saved AI account or exact model is no longer available.");
    }
    const selected = matches[0];
    if (!selected) throw new Error("The task's saved AI model selector is unavailable.");
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  if (requestedSelection?.kind === 'orchestration-engine') {
    const requestedEngine = readyOrchestrationEngine(runtimeStatus, requestedSelection.engineId);
    if (!requestedEngine) {
      throw new Error(
        `The selected orchestration engine is unavailable: ${requestedSelection.engineId}.`,
      );
    }
    const requestedModelId = requestedSelection.modelId?.trim() || ENGINE_MANAGED_MODEL_ID;
    if (
      requestedModelId !== ENGINE_MANAGED_MODEL_ID &&
      !isDeclaredOrchestrationModel(requestedEngine, requestedModelId)
    ) {
      throw new Error(`The selected orchestration model is unavailable: ${requestedModelId}.`);
    }
    return {
      target: orchestrationExecutionTarget(requestedEngine.engineId, requestedModelId),
      runtimeModelRef: orchestrationRuntimeModelRef(requestedEngine.engineId, requestedModelId),
    };
  }
  let selected: AiModelCatalogEntry | undefined;
  if (requestedSelection?.kind === 'api-model') {
    const matches = apiCandidates.filter(
      (model) => model.runtimeModelRef === requestedSelection.runtimeModelRef,
    );
    if (matches.length !== 1) {
      throw new Error(
        `The selected exact API model is unavailable or ambiguous: ${requestedSelection.runtimeModelRef}.`,
      );
    }
    [selected] = matches;
  } else {
    selected = apiCandidates.find((model) => model.availability === 'available');
    const defaultEngine = runtimeStatus.orchestrationEngines.find(
      (engine) => engine.state === 'ready',
    );
    if (!selected && defaultEngine) {
      return {
        target: orchestrationExecutionTarget(defaultEngine.engineId),
        runtimeModelRef: defaultEngine.engineId,
      };
    }
  }
  if (!selected) throw new Error('No available API model or orchestration engine was reported.');
  const target = validateExecutionTarget({
    engineId: selected.engineId,
    accountId: selected.accountId,
    billingMode: selected.billingMode,
    modelId: selected.modelId,
    modelSource: selected.source,
  });
  if (!target) throw new Error('The selected model catalog entry has invalid provenance.');
  return { target, runtimeModelRef: selected.runtimeModelRef };
}

export function resolveApiExecutionSelection(
  statusValue: unknown,
  requestedSelection: RuntimeExecutionSelector | undefined,
  frozenTarget: AiExecutionTarget | undefined,
): ResolvedApiExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (!Array.isArray(status.accounts) || !Array.isArray(status.models)) {
    throw new Error('AI Accounts status is unavailable. Check the configured API account.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts,
    models: status.models,
    orchestrationEngines: Array.isArray(status.orchestrationEngines)
      ? status.orchestrationEngines
      : [],
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const candidates = runtimeStatus.models.filter((model) =>
    availableApiModel(runtimeStatus, model),
  );
  let selected: AiModelCatalogEntry | undefined;
  if (frozenTarget) {
    const validTarget = validateExecutionTarget(frozenTarget);
    if (!validTarget || validTarget.engineId !== 'api' || validTarget.billingMode !== 'api') {
      throw new Error('This task does not have a valid API execution target.');
    }
    selected = candidates.find(
      (model) =>
        model.engineId === validTarget.engineId &&
        model.accountId === validTarget.accountId &&
        model.billingMode === validTarget.billingMode &&
        model.modelId === validTarget.modelId &&
        (!requestedSelection ||
          (requestedSelection.kind === 'api-model' &&
            requestedSelection.runtimeModelRef === model.runtimeModelRef)),
    );
    if (!selected) {
      throw new Error("The task's saved API account or exact model is no longer available.");
    }
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  if (requestedSelection?.kind === 'orchestration-engine') {
    throw new Error('An orchestration-engine selector cannot resolve through the API lane.');
  }
  if (requestedSelection) {
    const matches = candidates.filter(
      (model) => model.runtimeModelRef === requestedSelection.runtimeModelRef,
    );
    if (matches.length !== 1) {
      throw new Error(
        `The selected exact API model is unavailable or ambiguous: ${requestedSelection.runtimeModelRef}.`,
      );
    }
    [selected] = matches;
  } else {
    selected = candidates.find((model) => model.availability === 'available');
  }
  if (!selected) {
    throw new Error('No verified, stable API model is available for the configured account.');
  }
  const target = validateExecutionTarget({
    engineId: selected.engineId,
    accountId: selected.accountId,
    billingMode: selected.billingMode,
    modelId: selected.modelId,
    modelSource: selected.source,
  });
  if (!target) {
    throw new Error('The selected model catalog entry has invalid execution provenance.');
  }
  return { target, runtimeModelRef: selected.runtimeModelRef };
}
