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

function orchestrationExecutionTarget(engineId: string): AiExecutionTarget {
  return {
    engineId,
    accountId: `${engineId}:local`,
    billingMode: 'subscription',
    modelId: 'engine-managed',
    modelSource: { kind: 'native' },
  };
}

function readyOrchestrationEngine(
  status: AiRuntimeStatus,
  engineId: string,
): OrchestrationEngineStatus | undefined {
  return status.orchestrationEngines.find(
    (engine) => engine.engineId === engineId && engine.state === 'ready',
  );
}

function isCanonicalOrchestrationTarget(target: AiExecutionTarget): boolean {
  return isSameExecutionTarget(target, orchestrationExecutionTarget(target.engineId));
}

/** Resolve one globally unique model/account/engine before the gateway crosses
 * into an adapter. Exact model ids are accepted only when they identify one
 * catalog row; adapter-private runtime refs remain the unambiguous selector. */
export function resolveRuntimeExecutionSelection(
  statusValue: unknown,
  requestedModel: string | undefined,
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
  const requested = requestedModel?.trim();
  if (frozenTarget) {
    const validTarget = validateExecutionTarget(frozenTarget);
    if (!validTarget) throw new Error('This task does not have a valid execution target.');
    const frozenEngine = readyOrchestrationEngine(runtimeStatus, validTarget.engineId);
    if (frozenEngine) {
      if (
        !isCanonicalOrchestrationTarget(validTarget) ||
        frozenRuntimeModelRef?.trim() !== frozenEngine.engineId ||
        (requested && requested !== frozenEngine.engineId)
      ) {
        throw new Error("The task's saved orchestration engine is no longer available.");
      }
      return {
        target: orchestrationExecutionTarget(frozenEngine.engineId),
        runtimeModelRef: frozenEngine.engineId,
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
        (!requested || requested === model.runtimeModelRef || requested === model.modelId),
    );
    if (matches.length !== 1) {
      throw new Error("The task's saved AI account or exact model is no longer available.");
    }
    const selected = matches[0];
    if (!selected) throw new Error("The task's saved AI model selector is unavailable.");
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  const requestedEngine = requested
    ? readyOrchestrationEngine(runtimeStatus, requested)
    : undefined;
  if (requestedEngine) {
    return {
      target: orchestrationExecutionTarget(requestedEngine.engineId),
      runtimeModelRef: requestedEngine.engineId,
    };
  }
  let selected: AiModelCatalogEntry | undefined;
  if (requested) {
    const runtimeRefMatch = apiCandidates.find((model) => model.runtimeModelRef === requested);
    if (runtimeRefMatch) {
      selected = runtimeRefMatch;
    } else {
      const modelIdMatches = apiCandidates.filter((model) => model.modelId === requested);
      if (modelIdMatches.length !== 1) {
        throw new Error(`The selected exact AI model is unavailable or ambiguous: ${requested}.`);
      }
      [selected] = modelIdMatches;
    }
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
  requestedModel: string | undefined,
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
  const requested = requestedModel?.trim();
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
        (!requested || requested === model.runtimeModelRef || requested === model.modelId),
    );
    if (!selected) {
      throw new Error("The task's saved API account or exact model is no longer available.");
    }
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  if (requested) {
    const matches = candidates.filter(
      (model) => model.runtimeModelRef === requested || model.modelId === requested,
    );
    if (matches.length !== 1) {
      throw new Error(`The selected exact API model is unavailable or ambiguous: ${requested}.`);
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
