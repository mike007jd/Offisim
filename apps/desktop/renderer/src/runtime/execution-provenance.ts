export type AiBillingMode = 'api' | 'subscription';

export interface TurnExecutionProvenance {
  engineId: string;
  accountId: string;
  billingMode: AiBillingMode;
  modelId: string;
  runId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

export function validateTurnExecutionProvenance(
  value: unknown,
  expectedRunId?: string,
): TurnExecutionProvenance | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new Error('Agent runtime returned invalid execution provenance.');
  const { engineId, accountId, billingMode, modelId, runId } = value;
  if (
    !isNonEmptyString(engineId) ||
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(modelId) ||
    !isNonEmptyString(runId)
  ) {
    throw new Error('Agent runtime returned incomplete execution provenance.');
  }
  if (billingMode !== 'api' && billingMode !== 'subscription') {
    throw new Error(`Agent runtime returned unsupported billing mode: ${String(billingMode)}.`);
  }
  if (expectedRunId && runId !== expectedRunId) {
    throw new Error(
      `Agent runtime provenance run mismatch: expected ${expectedRunId}, got ${runId}.`,
    );
  }
  return { engineId, accountId, billingMode, modelId, runId };
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
}
