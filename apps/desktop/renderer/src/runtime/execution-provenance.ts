import type {
  AiBillingMode,
  AiExecutionTarget,
  AiModelSource,
  TurnExecutionProvenance,
} from '@offisim/shared-types';

export type { AiBillingMode, AiExecutionTarget, TurnExecutionProvenance };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function parseModelSource(value: unknown): AiModelSource | null {
  if (!isRecord(value)) return null;
  const { kind, sourceUrl, checkedAt } = value;
  if (
    (kind !== 'official-api' && kind !== 'native') ||
    !isNonEmptyString(sourceUrl) ||
    !isNonEmptyString(checkedAt) ||
    !Number.isFinite(Date.parse(checkedAt))
  ) {
    return null;
  }
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { kind, sourceUrl, checkedAt };
}

export function validateExecutionTarget(value: unknown): AiExecutionTarget | null {
  if (!isRecord(value)) return null;
  const { engineId, accountId, billingMode, modelId } = value;
  const modelSource = parseModelSource(value.modelSource);
  if (
    !isNonEmptyString(engineId) ||
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(modelId) ||
    (billingMode !== 'api' && billingMode !== 'subscription') ||
    !modelSource
  ) {
    return null;
  }
  return { engineId, accountId, billingMode, modelId, modelSource };
}

export function validateTurnExecutionProvenance(
  value: unknown,
  expectedRunId?: string,
): TurnExecutionProvenance | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error('Agent runtime returned invalid execution provenance.');
  const target = validateExecutionTarget(value);
  const { runId } = value;
  if (!target || !isNonEmptyString(runId)) {
    throw new Error('Agent runtime returned incomplete execution provenance.');
  }
  if (expectedRunId && runId !== expectedRunId) {
    throw new Error(
      `Agent runtime provenance run mismatch: expected ${expectedRunId}, got ${runId}.`,
    );
  }
  const adapter = isRecord(value.adapter)
    ? {
        id: isNonEmptyString(value.adapter.id) ? value.adapter.id : '',
        version: isNonEmptyString(value.adapter.version) ? value.adapter.version : '',
      }
    : undefined;
  if (adapter && (!adapter.id || !adapter.version)) {
    throw new Error('Agent runtime returned invalid adapter diagnostics.');
  }
  const runtimeModelRef = isNonEmptyString(value.runtimeModelRef)
    ? value.runtimeModelRef.trim()
    : undefined;
  return {
    ...target,
    runId,
    ...(runtimeModelRef ? { runtimeModelRef } : {}),
    ...(adapter ? { adapter } : {}),
  };
}

export function requireTurnExecutionProvenance(
  value: unknown,
  expectedRunId?: string,
): TurnExecutionProvenance {
  const provenance = validateTurnExecutionProvenance(value, expectedRunId);
  if (!provenance) {
    throw new Error('Agent runtime returned no execution provenance.');
  }
  return provenance;
}

export function assertSameExecutionAccount(
  source: TurnExecutionProvenance,
  actual: TurnExecutionProvenance,
): void {
  for (const key of ['engineId', 'accountId', 'billingMode', 'modelId'] as const) {
    if (source[key] !== actual[key]) {
      throw new Error(
        `Isolated text job provenance mismatch for ${key}: expected ${source[key]}, got ${actual[key]}.`,
      );
    }
  }
  if (
    source.modelSource.kind !== actual.modelSource.kind ||
    source.modelSource.sourceUrl !== actual.modelSource.sourceUrl ||
    source.modelSource.checkedAt !== actual.modelSource.checkedAt
  ) {
    throw new Error('Isolated text job provenance mismatch for modelSource.');
  }
  if (
    source.adapter &&
    (!actual.adapter ||
      source.adapter.id !== actual.adapter.id ||
      source.adapter.version !== actual.adapter.version)
  ) {
    const expected = `${source.adapter.id}@${source.adapter.version}`;
    const received = actual.adapter ? `${actual.adapter.id}@${actual.adapter.version}` : 'missing';
    throw new Error(
      `Isolated text job provenance mismatch for adapter: expected ${expected}, got ${received}.`,
    );
  }
}
