import { createHash } from 'node:crypto';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function providerAccountMaterial(authStorage, provider, credential) {
  for (const key of ['accountId', 'account_id', 'userId', 'user_id', 'subject', 'sub']) {
    const value = nonEmpty(credential?.[key]);
    if (value) return `${key}:${value}`;
  }

  // An opaque credential cannot prove that two secret generations belong to the
  // same paid account. Hash the active generation instead of merging every local
  // credential for a provider into one account. Native subjects above remain
  // stable across refresh; opaque rotations may split history, but can never
  // combine usage or isolated jobs across an explicit account replacement.
  // API-key values may themselves be `$ENV_VAR` / `!secret-command` references.
  // Hash Pi's resolved active credential, never the stable reference text.
  const resolvedSecret = nonEmpty(
    await authStorage.getApiKey(provider, { includeFallback: true }),
  );
  if (!resolvedSecret) {
    throw Object.assign(new Error('Pi execution account identity is unavailable.'), {
      code: 'provenance-missing',
    });
  }
  return `credential-generation:${resolvedSecret}`;
}

export async function executionProvenance(authStorage, modelRegistry, model, runId) {
  const provider = nonEmpty(model?.provider);
  const modelId = nonEmpty(model?.id);
  const resolvedRunId = nonEmpty(runId);
  if (!provider || !modelId || !resolvedRunId) {
    throw Object.assign(new Error('Pi execution provenance is incomplete.'), {
      code: 'provenance-missing',
    });
  }
  const credential = authStorage.get(provider);
  const billingMode = modelRegistry.isUsingOAuth(model) ? 'subscription' : 'api';
  const accountMaterial = await providerAccountMaterial(authStorage, provider, credential);
  const accountFingerprint = createHash('sha256')
    .update(`${provider}\0${billingMode}\0${accountMaterial}`)
    .digest('hex')
    .slice(0, 16);
  return {
    engineId: 'pi-agent',
    accountId: `pi-agent:${provider}:${accountFingerprint}`,
    billingMode,
    modelId: `${provider}/${modelId}`,
    runId: resolvedRunId,
  };
}

export function assertSameExecutionAccount(source, actual) {
  if (!isRecord(source)) {
    throw Object.assign(new Error('Isolated text jobs require source Turn provenance.'), {
      code: 'provenance-missing',
    });
  }
  for (const key of ['engineId', 'accountId', 'billingMode', 'modelId']) {
    if (nonEmpty(source[key]) !== actual[key]) {
      throw Object.assign(
        new Error(
          `Isolated text job provenance mismatch for ${key}: expected ${String(source[key])}, got ${actual[key]}.`,
        ),
        { code: 'provenance-mismatch' },
      );
    }
  }
}
