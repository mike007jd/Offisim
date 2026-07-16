import { createHash, randomUUID } from 'node:crypto';

export const PI_EXECUTION_ADAPTER = Object.freeze({ id: 'pi-agent', version: '0.79.8' });
export const EXECUTION_TARGET_ACK_TIMEOUT_MS = 15_000;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function executionError(message, code = 'execution-target-mismatch') {
  return Object.assign(new Error(message), { code });
}

function requireModelSource(value) {
  if (
    !isRecord(value) ||
    (value.kind !== 'official-api' && value.kind !== 'native') ||
    !nonEmpty(value.sourceUrl) ||
    !nonEmpty(value.checkedAt)
  ) {
    throw executionError('The execution target is missing a verified model source.');
  }
  return {
    kind: value.kind,
    sourceUrl: nonEmpty(value.sourceUrl),
    checkedAt: nonEmpty(value.checkedAt),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedEndpointIdentity(model, provider) {
  const rawEndpoint = nonEmpty(model?.baseUrl);
  if (!rawEndpoint) return `provider:${provider}`;
  try {
    const endpoint = new URL(rawEndpoint);
    endpoint.username = '';
    endpoint.password = '';
    endpoint.search = '';
    endpoint.hash = '';
    endpoint.pathname = endpoint.pathname.replace(/\/+$/u, '') || '/';
    return endpoint.toString();
  } catch {
    return rawEndpoint.replace(/[?#].*$/u, '').replace(/\/+$/u, '') || `provider:${provider}`;
  }
}

function anonymousEndpointAccountId(model, provider) {
  const endpointFingerprint = createHash('sha256')
    .update(normalizedEndpointIdentity(model, provider))
    .digest('hex')
    .slice(0, 16);
  return `credential-generation:anonymous:${endpointFingerprint}`;
}

async function providerAccountMaterial(authStorage, modelRegistry, model, provider, credential) {
  for (const key of ['accountId', 'account_id', 'userId', 'user_id', 'subject', 'sub']) {
    const value = nonEmpty(credential?.[key]);
    if (value) return `${key}:${value}`;
  }

  // An opaque credential cannot prove that two secret generations belong to the
  // same paid account. Hash the active generation instead of merging every local
  // credential for a provider into one account. API-key values may themselves be
  // `$ENV_VAR` / `!secret-command` references, so hash Pi's resolved secret.
  let resolvedSecret;
  if (!modelRegistry.isUsingOAuth(model) && modelRegistry.getApiKeyAndHeaders) {
    const resolved = await modelRegistry.getApiKeyAndHeaders(model);
    resolvedSecret = resolved?.ok ? nonEmpty(resolved.apiKey) : undefined;
  }
  resolvedSecret ??= nonEmpty(await authStorage.getApiKey(provider, { includeFallback: true }));
  return resolvedSecret ? `credential-generation:${resolvedSecret}` : undefined;
}

export function runtimeModelRefFor(model) {
  const provider = nonEmpty(model?.provider);
  const modelId = nonEmpty(model?.id);
  if (!provider || !modelId) {
    throw executionError('The runtime model identity is incomplete.', 'provenance-missing');
  }
  return `${provider}/${modelId}`;
}

export async function executionAccountIdentity(authStorage, modelRegistry, model) {
  const provider = nonEmpty(model?.provider);
  const modelId = nonEmpty(model?.id);
  if (!provider || !modelId) {
    throw executionError('The execution account identity is incomplete.', 'provenance-missing');
  }
  const credential = authStorage.get(provider);
  const billingMode = modelRegistry.isUsingOAuth(model) ? 'subscription' : 'api';
  const accountMaterial = await providerAccountMaterial(
    authStorage,
    modelRegistry,
    model,
    provider,
    credential,
  );
  const accountId = accountMaterial
    ? `api:${provider}:${createHash('sha256')
        .update(`${provider}\0${billingMode}\0${accountMaterial}`)
        .digest('hex')
        .slice(0, 16)}`
    : anonymousEndpointAccountId(model, provider);
  return {
    engineId: 'api',
    accountId,
    billingMode,
  };
}

export async function executionProvenance(authStorage, modelRegistry, model, runId, modelSource) {
  const modelId = nonEmpty(model?.id);
  const resolvedRunId = nonEmpty(runId);
  if (!modelId || !resolvedRunId) {
    throw executionError('The execution provenance is incomplete.', 'provenance-missing');
  }
  const account = await executionAccountIdentity(authStorage, modelRegistry, model);
  return {
    ...account,
    // Product identity is the upstream leaf id. The adapter provider only exists
    // in runtimeModelRef / diagnostics and must never leak into modelId.
    modelId,
    modelSource: requireModelSource(modelSource),
    runId: resolvedRunId,
    adapter: PI_EXECUTION_ADAPTER,
  };
}

export function executionTargetDigest(expectedTarget, runtimeModelRef) {
  const source = requireModelSource(expectedTarget?.modelSource);
  const canonical = {
    engineId: nonEmpty(expectedTarget?.engineId),
    accountId: nonEmpty(expectedTarget?.accountId),
    billingMode: nonEmpty(expectedTarget?.billingMode),
    modelId: nonEmpty(expectedTarget?.modelId),
    modelSource: source,
    runtimeModelRef: nonEmpty(runtimeModelRef),
  };
  if (
    !canonical.engineId ||
    !canonical.accountId ||
    !canonical.billingMode ||
    !canonical.modelId ||
    !canonical.runtimeModelRef
  ) {
    throw executionError('The execution target is incomplete.');
  }
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

export function assertExpectedExecutionTarget({
  expectedTarget,
  runtimeModelRef,
  actual,
  modelFallbackMessage,
}) {
  if (nonEmpty(modelFallbackMessage)) {
    throw executionError(`Model fallback was refused: ${nonEmpty(modelFallbackMessage)}`);
  }
  if (!isRecord(expectedTarget)) throw executionError('The expected execution target is missing.');
  if (expectedTarget.engineId !== 'api') {
    throw executionError(
      `The API adapter cannot execute engine "${String(expectedTarget.engineId)}".`,
    );
  }
  if (expectedTarget.billingMode !== 'api') {
    throw executionError('The API adapter cannot execute a subscription account.');
  }
  if (actual.billingMode !== 'api') {
    throw executionError(
      'The selected runtime credential is a subscription credential, not an API account.',
      'execution-target-subscription',
    );
  }
  const expectedRuntimeRef = nonEmpty(runtimeModelRef);
  if (!expectedRuntimeRef || expectedRuntimeRef !== runtimeModelRefFor(actual.__model)) {
    throw executionError(
      `Runtime model mismatch: expected ${String(expectedRuntimeRef)}, observed ${runtimeModelRefFor(actual.__model)}.`,
    );
  }
  for (const key of ['engineId', 'accountId', 'billingMode', 'modelId']) {
    if (nonEmpty(expectedTarget[key]) !== actual[key]) {
      throw executionError(
        `Execution target mismatch for ${key}: expected ${String(expectedTarget[key])}, observed ${String(actual[key])}.`,
      );
    }
  }
  const expectedSource = requireModelSource(expectedTarget.modelSource);
  if (stableJson(expectedSource) !== stableJson(actual.modelSource)) {
    throw executionError('Execution target model source changed before execution.');
  }
}

export function assertSameExecutionAccount(source, actual) {
  if (!isRecord(source)) {
    throw executionError(
      'Isolated text jobs require source Turn provenance.',
      'provenance-missing',
    );
  }
  for (const key of ['engineId', 'accountId', 'billingMode', 'modelId']) {
    if (nonEmpty(source[key]) !== actual[key]) {
      throw executionError(
        `Isolated text job provenance mismatch for ${key}: expected ${String(source[key])}, got ${actual[key]}.`,
        'provenance-mismatch',
      );
    }
  }
  if (
    stableJson(requireModelSource(source.modelSource)) !==
    stableJson(requireModelSource(actual.modelSource))
  ) {
    throw executionError(
      'Isolated text job provenance mismatch for modelSource.',
      'provenance-mismatch',
    );
  }
}

/**
 * Session-created / prompt-not-yet-called execution gate. The renderer is the
 * product target authority; the host proves what the adapter actually selected,
 * emits that immutable identity, then parks until Rust writes the renderer ACK.
 */
export function createExecutionTargetGate({
  emit,
  requestId,
  timeoutMs = EXECUTION_TARGET_ACK_TIMEOUT_MS,
  newPrepareId = () => `prepare-${randomUUID()}`,
} = {}) {
  const resolvedRequestId = nonEmpty(requestId);
  if (typeof emit !== 'function' || !resolvedRequestId) {
    throw executionError('Execution target gate requires emit and requestId.', 'invalid-request');
  }
  const pending = new Map();
  let closedError;

  async function prepare({
    authStorage,
    modelRegistry,
    session,
    modelFallbackMessage,
    expectedTarget,
    runtimeModelRef,
    runId,
  }) {
    if (closedError) throw closedError;
    const model = session?.model;
    const identity = await executionProvenance(
      authStorage,
      modelRegistry,
      model,
      runId,
      expectedTarget?.modelSource,
    );
    // Internal-only model pointer for the exact runtime ref assertion. It is
    // removed before anything crosses stdout.
    Object.defineProperty(identity, '__model', { value: model, enumerable: false });
    assertExpectedExecutionTarget({
      expectedTarget,
      runtimeModelRef,
      actual: identity,
      modelFallbackMessage,
    });
    const targetDigest = executionTargetDigest(expectedTarget, runtimeModelRef);
    const prepareId = nonEmpty(newPrepareId());
    if (!prepareId || pending.has(prepareId)) {
      throw executionError(
        'Execution preparation id is invalid or reused.',
        'execution-target-ack-invalid',
      );
    }

    const acknowledged = new Promise((resolve, reject) => {
      const fail = (error) => {
        const state = pending.get(prepareId);
        if (!state || !pending.delete(prepareId)) return;
        if (state?.timer) clearTimeout(state.timer);
        reject(error);
      };
      const state = { targetDigest, resolve, fail, timer: undefined };
      pending.set(prepareId, state);
      state.timer = setTimeout(
        () =>
          fail(
            executionError(
              `Execution target acknowledgement timed out for ${prepareId}.`,
              'execution-target-ack-timeout',
            ),
          ),
        timeoutMs,
      );
    });

    emit({
      kind: 'executionPrepared',
      prepareId,
      runId: identity.runId,
      identity,
      targetDigest,
      adapter: PI_EXECUTION_ADAPTER,
    });
    await acknowledged;
    return Object.freeze({
      prepareId,
      targetDigest,
      identity,
      runtimeModelRef: nonEmpty(runtimeModelRef),
      session,
      model,
    });
  }

  function resolveAck(message) {
    if (message?.type !== 'executionTargetAck') return false;
    const prepareId = nonEmpty(message.prepareId);
    const state = prepareId ? pending.get(prepareId) : undefined;
    if (!state) return false;
    if (
      nonEmpty(message.requestId) !== resolvedRequestId ||
      nonEmpty(message.targetDigest) !== state.targetDigest
    ) {
      state.fail(
        executionError(
          `Execution target acknowledgement did not match ${prepareId}.`,
          'execution-target-ack-invalid',
        ),
      );
      return true;
    }
    pending.delete(prepareId);
    if (state.timer) clearTimeout(state.timer);
    state.resolve();
    return true;
  }

  function assertPrepared(prepared, session) {
    if (!prepared || prepared.session !== session || prepared.model !== session?.model) {
      throw executionError(
        'The prepared execution session or model changed before prompt.',
        'execution-target-session-changed',
      );
    }
    if (
      prepared.runtimeModelRef !== runtimeModelRefFor(session.model) ||
      prepared.targetDigest !== executionTargetDigest(prepared.identity, prepared.runtimeModelRef)
    ) {
      throw executionError(
        'The prepared execution identity changed before prompt.',
        'execution-target-session-changed',
      );
    }
  }

  function close(reason = 'Execution target acknowledgement channel closed.') {
    if (closedError) return;
    closedError = executionError(reason, 'execution-target-ack-closed');
    for (const state of [...pending.values()]) state.fail(closedError);
    pending.clear();
  }

  return Object.freeze({ prepare, resolveAck, assertPrepared, close });
}
