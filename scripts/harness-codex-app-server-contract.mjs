import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = join(ROOT, 'scripts/fixtures/codex-app-server-contract.json');
const MANIFEST_PATH = join(ROOT, 'apps/desktop/src-tauri/binaries/codex-app-server.manifest.json');
const TAURI_CONFIG_PATH = join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const HOST_DIR = join(ROOT, 'apps/desktop/src-tauri/src/codex_agent_host');
const TAURI_LIB_PATH = join(ROOT, 'apps/desktop/src-tauri/src/lib.rs');
const COMMAND_REGISTRY_PATH = join(ROOT, 'apps/desktop/renderer/src/lib/tauri-commands.ts');
const TASK_BINDING_PATH = join(ROOT, 'apps/desktop/src-tauri/src/task_workspace_binding.rs');
const DESKTOP_RUNTIME_PATH = join(
  ROOT,
  'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
);
const SHARED_ACCOUNT_PATH = join(ROOT, 'packages/shared-types/src/runtime/ai-account.ts');
const AI_ACCOUNTS_PANE_PATH = join(
  ROOT,
  'apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx',
);
const PACKAGE_PATH = join(ROOT, 'package.json');
const ARTIFACT_CHECK_PATH = join(ROOT, 'scripts/check-codex-app-server-artifact.mjs');
const BUNDLE_CHECK_PATH = join(ROOT, 'scripts/check-codex-app-server-bundle.mjs');
const BUNDLE_FINALIZER_PATH = join(ROOT, 'scripts/finalize-codex-app-server-bundle.mjs');
const RELEASE_DMG_PATH = join(ROOT, 'scripts/build-signed-dmg.mjs');
const CARGO_TEST_PREP_PATH = join(ROOT, 'scripts/prepare-desktop-cargo-test.mjs');

const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const fixture = json(FIXTURE_PATH);
const manifest = json(MANIFEST_PATH);
const tauriConfig = json(TAURI_CONFIG_PATH);
const packageJson = json(PACKAGE_PATH);
const rustHostFiles = readdirSync(HOST_DIR)
  .filter((name) => name.endsWith('.rs'))
  .sort();
const rustHostUnits = rustHostFiles.map((name) => read(join(HOST_DIR, name)));
const rustHostSource = rustHostUnits.join('\n');
const rustHostProductionSource = rustHostUnits
  .map((source) => source.split(/\n#\[cfg\(test\)\]/u, 1)[0])
  .join('\n');
const tauriLibSource = read(TAURI_LIB_PATH);
const commandRegistrySource = read(COMMAND_REGISTRY_PATH);
const taskBindingSource = read(TASK_BINDING_PATH);
const desktopRuntimeSource = read(DESKTOP_RUNTIME_PATH);
const sharedAccountSource = read(SHARED_ACCOUNT_PATH);
const aiAccountsPaneSource = read(AI_ACCOUNTS_PANE_PATH);
const artifactCheckSource = read(ARTIFACT_CHECK_PATH);
const bundleCheckSource = read(BUNDLE_CHECK_PATH);
const bundleFinalizerSource = read(BUNDLE_FINALIZER_PATH);
const releaseDmgSource = read(RELEASE_DMG_PATH);
const cargoTestPrepSource = read(CARGO_TEST_PREP_PATH);

function hasLiteral(source, value) {
  return source.includes(JSON.stringify(value));
}

function requireLiteral(source, value, label) {
  assert.ok(
    hasLiteral(source, value),
    `${label} must contain exact literal ${JSON.stringify(value)}`,
  );
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function structBody(source, name) {
  const start = source.search(new RegExp(`(?:pub(?:\\([^)]*\\))?\\s+)?struct\\s+${name}\\b`, 'u'));
  assert.notEqual(start, -1, `Rust struct ${name} must exist`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1, `Rust struct ${name} must have a body`);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  assert.fail(`Rust struct ${name} has an unterminated body`);
}

function bracedBody(source, startPattern, label) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `${label} must exist`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1, `${label} must have a body`);
  return bodyFromBrace(source, brace, label);
}

function bodyFromBrace(source, brace, label) {
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  assert.fail(`${label} has an unterminated body`);
}

function typescriptFunctionBody(source, startPattern, label) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `${label} must exist`);
  const parameterOpen = source.indexOf('(', start);
  assert.notEqual(parameterOpen, -1, `${label} must have parameters`);
  let parameterDepth = 0;
  let parameterClose = -1;
  for (let index = parameterOpen; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parameterClose = index;
        break;
      }
    }
  }
  assert.notEqual(parameterClose, -1, `${label} has unterminated parameters`);
  const brace = source.indexOf('{', parameterClose);
  assert.notEqual(brace, -1, `${label} must have a body`);
  return bodyFromBrace(source, brace, label);
}

function functionBody(source, name) {
  return bracedBody(source, new RegExp(`\\bfn\\s+${name}\\b`, 'u'), `Rust function ${name}`);
}

function assertFreshIsoTimestamp(value, windowDays) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u);
  const checkedAt = Date.parse(value);
  assert.ok(Number.isFinite(checkedAt), `invalid checkedAt timestamp ${value}`);
  const ageMs = Date.now() - checkedAt;
  assert.ok(ageMs >= -86_400_000, 'checkedAt must not be more than one day in the future');
  assert.ok(ageMs <= windowDays * 86_400_000, `checkedAt is older than ${windowDays} days`);
}

assert.equal(fixture.schemaVersion, 1);
assertFreshIsoTimestamp(fixture.checkedAt, fixture.freshnessWindowDays);
assert.match(fixture.officialSources.protocol, /^https:\/\/developers\.openai\.com\//u);
assert.match(fixture.officialSources.release, /^https:\/\/github\.com\/openai\/codex\//u);

assert.deepEqual(
  {
    component: manifest.component,
    version: manifest.version,
    releaseTag: manifest.releaseTag,
    targetTriple: manifest.targetTriple,
    archive: {
      fileName: manifest.archive?.fileName,
      url: manifest.archive?.url,
      byteLength: manifest.archive?.byteLength,
      sha256: manifest.archive?.sha256,
    },
    binary: {
      externalBin: fixture.artifact.binary.externalBin,
      outputFileName: manifest.binary?.outputFileName,
      byteLength: manifest.binary?.byteLength,
      sha256: manifest.binary?.sha256,
      architecture: manifest.binary?.architecture,
      minimumMacOSVersion: manifest.binary?.minimumMacOSVersion,
    },
  },
  fixture.artifact,
  'checked-in app-server manifest must match the official artifact contract exactly',
);
assert.equal(manifest.releaseUrl, fixture.officialSources.release);
assert.equal(manifest.checkedAt, fixture.checkedAt.slice(0, 10));
assert.equal(manifest.schemaVersion, 2);
assert.match(fixture.artifact.archive.sha256, /^[a-f0-9]{64}$/u);
assert.ok(fixture.artifact.archive.byteLength > 0);
assert.match(fixture.artifact.binary.sha256, /^[a-f0-9]{64}$/u);
assert.ok(fixture.artifact.binary.byteLength > 0);
assert.match(
  artifactCheckSource,
  /assertEqual\(binaryStat\.size,\s*manifest\.binary\.byteLength,\s*'binary byte length'\)/u,
  'artifact checker must verify the extracted binary byte length',
);
assert.match(
  artifactCheckSource,
  /assertEqual\(digest,\s*manifest\.binary\.sha256,\s*'binary SHA-256'\)/u,
  'artifact checker must verify the extracted binary digest',
);
assert.match(
  bundleFinalizerSource,
  /digest !== manifest\.binary\.sha256/u,
  'bundle finalizer must bind the restored sidecar to the checked-in binary digest',
);
for (const variable of ['OFFISIM_CODEX_MANIFEST', 'OFFISIM_CODEX_ARCHIVE']) {
  assert.doesNotMatch(
    bundleFinalizerSource,
    new RegExp(`configuredValue\\(['"]${variable}['"]\\)`, 'u'),
    `bundle finalizer must not accept ambient ${variable}`,
  );
}
assert.match(
  bundleCheckSource,
  /verifyBinary\(sidecarPath, manifest\)/u,
  'post-bundle checker must verify the final sidecar bytes against the manifest',
);
const releaseEnvironmentBody = bracedBody(
  releaseDmgSource,
  /function\s+withoutAppleCredentials\s*\(/u,
  'release environment sanitizer',
);
assert.match(releaseEnvironmentBody, /delete\s+result\[key\]/u);
for (const variable of ['OFFISIM_CODEX_MANIFEST', 'OFFISIM_CODEX_ARCHIVE']) {
  assert.match(
    releaseEnvironmentBody,
    new RegExp(`['"]${variable}['"]`, 'u'),
    `release environment sanitizer for ${variable}`,
  );
}
const releaseMainBody = bracedBody(
  releaseDmgSource,
  /async\s+function\s+main\s*\(/u,
  'release DMG main',
);
assert.match(
  releaseMainBody,
  /loadManifest\(pinnedCodexManifestPath\)/u,
  'release must load only the checked-in Codex manifest',
);
assert.match(
  releaseMainBody,
  /defaultArchivePath\(pinnedCodexManifest\)/u,
  'release must resolve the archive from the checked-in manifest',
);
assert.match(
  releaseMainBody,
  /['"]--manifest['"]\s*,\s*pinnedCodexManifestPath/u,
  'release finalization must pass the checked-in manifest explicitly',
);
assert.match(
  releaseMainBody,
  /['"]--archive['"]\s*,\s*pinnedCodexArchivePath/u,
  'release finalization must pass the exact archive path explicitly',
);

assert.ok(
  tauriConfig.bundle?.externalBin?.includes(fixture.artifact.binary.externalBin),
  'Tauri must package app-server through externalBin',
);
assert.equal(
  tauriConfig.bundle?.macOS?.minimumSystemVersion,
  fixture.artifact.binary.minimumMacOSVersion,
  'Tauri minimum macOS version must satisfy the official binary',
);
for (const resource of [
  'resources/third-party/codex/LICENSE',
  'resources/third-party/codex/NOTICE',
]) {
  assert.ok(
    tauriConfig.bundle?.resources?.includes(resource),
    `Tauri bundle must include ${resource}`,
  );
}

assert.equal(fixture.transport.kind, 'stdio-jsonl');
assert.deepEqual(fixture.transport.handshake, ['initialize', 'initialized']);
assert.deepEqual(fixture.initializeCapabilities, {
  experimentalApi: true,
  requestAttestation: false,
  mcpServerOpenaiFormElicitation: false,
});
const initializeBody = functionBody(rustHostProductionSource, 'initialize');
for (const [capability, enabled] of Object.entries(fixture.initializeCapabilities)) {
  assert.match(
    initializeBody,
    new RegExp(`"${capability}"\\s*:\\s*${enabled}`, 'u'),
    `initialize must explicitly negotiate ${capability}=${enabled}`,
  );
}
for (const method of fixture.clientMethods)
  requireLiteral(rustHostProductionSource, method, 'Rust Codex host');
for (const method of fixture.serverRequestMethods) {
  requireLiteral(rustHostProductionSource, method, 'Rust Codex host');
}
assert.doesNotMatch(
  rustHostProductionSource,
  /json!\s*\(\s*\{\s*"jsonrpc"/u,
  'app-server protocol frames must not add a JSON-RPC version field',
);

for (const decision of fixture.approvals.commandAndFileDecisions) {
  requireLiteral(rustHostProductionSource, decision, 'Rust Codex approval mapper');
}
for (const decision of fixture.approvals.forbiddenPersistentDecisions) {
  assert.equal(
    hasLiteral(rustHostProductionSource, decision),
    false,
    `Offisim must not persist or auto-reuse native approval decision ${decision}`,
  );
}
requireLiteral(
  rustHostProductionSource,
  fixture.approvals.permissionScope,
  'Rust Codex permission mapper',
);
assert.doesNotMatch(
  rustHostProductionSource,
  /"scope"\s*:\s*"session"/u,
  'additional permission grants must remain turn-scoped',
);

const nativeModelBody = structBody(rustHostProductionSource, 'NativeModel');
for (const field of [
  'id',
  'model',
  'display_name',
  'description',
  'hidden',
  'default_reasoning_effort',
  'supported_reasoning_efforts',
  'is_default',
]) {
  assert.match(
    nativeModelBody,
    new RegExp(`\\b${field}\\s*:`, 'u'),
    `NativeModel must decode ${field}`,
  );
}
const nativeModelListBody = structBody(rustHostProductionSource, 'NativeModelListResponse');
for (const field of fixture.nativeShapes.modelList.responseFields) {
  assert.match(nativeModelListBody, new RegExp(`\\b${camelToSnake(field)}\\s*:`, 'u'));
}
const selectionFixture = fixture.nativeShapes.modelList.splitIdentityFixture;
assert.notEqual(
  selectionFixture.id,
  selectionFixture.model,
  'split identity fixture must distinguish stable selector id from exact model leaf',
);
assert.equal(fixture.nativeShapes.modelList.stableSelectorField, 'id');
assert.equal(fixture.nativeShapes.modelList.exactLeafField, 'model');
assert.deepEqual(fixture.nativeShapes.modelList.requestSelector, {
  threadStartField: 'model',
  turnStartField: 'model',
  valueSource: 'id',
});
assert.deepEqual(fixture.nativeShapes.modelList.startedCheckpoint, {
  summaryLeafField: 'id',
  summarySelectorField: 'catalogId',
  summaryApi: 'codex-app-server',
  persistedRuntimeModelRef: 'codex:<catalogId>',
});
assertFreshIsoTimestamp(
  fixture.nativeShapes.modelList.verifiedRuntimeLeaf.checkedAt,
  fixture.freshnessWindowDays,
);
assert.match(
  fixture.nativeShapes.modelList.verifiedRuntimeLeaf.selectorId,
  /^[a-z0-9][a-z0-9._-]+$/u,
);
assert.match(fixture.nativeShapes.modelList.verifiedRuntimeLeaf.modelId, /^[a-z0-9][a-z0-9._-]+$/u);
assert.equal(fixture.nativeShapes.modelList.verifiedRuntimeLeaf.sourceMethod, 'model/list');
assert.equal(
  fixture.nativeShapes.modelList.verifiedRuntimeLeaf.sourceUrl,
  fixture.officialSources.protocol,
);
const statusResponseBody = functionBody(rustHostProductionSource, 'status_response');
assert.equal(fixture.productProjection.modelSourceKind, 'native');
assert.match(
  statusResponseBody,
  /"kind"\s*:\s*"native"/u,
  'Codex model catalog provenance must use the engine-neutral native source kind',
);
assert.match(
  statusResponseBody,
  /"modelId"\s*:\s*model\.model\b/u,
  'catalog modelId must preserve NativeModel.model as the exact leaf',
);
assert.doesNotMatch(
  statusResponseBody,
  /"modelId"\s*:\s*model\.id\b/u,
  'stable selector id must not be mislabeled as the exact leaf modelId',
);
const runtimeModelRefBody = functionBody(rustHostProductionSource, 'runtime_model_ref');
assert.match(
  runtimeModelRefBody,
  /format!\s*\(\s*"codex:\{\}"\s*,\s*model\.id\s*\)/u,
  'runtime model refs must be built from the stable NativeModel.id selector',
);
assert.doesNotMatch(runtimeModelRefBody, /model\.model\b/u);
const nativeModelSelectorBody = functionBody(rustHostProductionSource, 'native_model_selector');
assert.match(nativeModelSelectorBody, /model\.id\.as_str\(\)/u);
assert.doesNotMatch(nativeModelSelectorBody, /model\.model\b/u);
const targetValidationBody = functionBody(rustHostProductionSource, 'validate_execution_target');
assert.match(
  targetValidationBody,
  /runtime_model_ref\s*\(\s*model\s*\)\s*==\s*runtime_ref\s*&&\s*model\.model\s*==\s*target\.model_id/u,
  'execution target must bind the stable selector ref and exact leaf modelId together',
);
const startNativeThreadBody = functionBody(rustHostProductionSource, 'start_native_thread');
assert.equal(
  [...startNativeThreadBody.matchAll(/"model"\s*:\s*native_model_selector\s*\(\s*model\s*\)/gu)]
    .length,
  2,
  'thread start and resume must both send the stable model preset id',
);
assert.doesNotMatch(
  startNativeThreadBody,
  /"model"\s*:\s*model\.model\b/u,
  'thread start/resume must not send the underlying leaf slug as the preset selector',
);
const startNativeTurnBody = functionBody(rustHostProductionSource, 'start_native_turn');
assert.match(
  startNativeTurnBody,
  /let\s+model_selector\s*=\s*native_model_selector\s*\(\s*model\s*\)/u,
  'turn start must resolve the stable model preset id once',
);
assert.match(
  startNativeTurnBody,
  /"model"\s*:\s*model_selector\b/u,
  'turn start must send the stable model preset id',
);
assert.doesNotMatch(
  startNativeTurnBody,
  /"model"\s*:\s*model\.model\b/u,
  'app-server requests must not send the underlying leaf slug as the preset selector',
);
const codexModelSummaryBody = structBody(rustHostProductionSource, 'CodexModelSummary');
assert.match(
  codexModelSummaryBody,
  /\bcatalog_id\s*:/u,
  'Started model summary must carry the stable app-server selector separately',
);
const modelSummaryBody = functionBody(rustHostProductionSource, 'model_summary');
assert.match(
  modelSummaryBody,
  /\bid:\s*Some\s*\(\s*actual_model\.to_string\(\)\s*\)/u,
  'Started model summary id must be the exact model leaf actually used',
);
assert.match(
  modelSummaryBody,
  /\bapi:\s*Some\s*\(\s*NATIVE_THREAD_PROTOCOL\.into\(\)\s*\)/u,
  'Started model summary must identify the Codex app-server protocol',
);
assert.match(
  modelSummaryBody,
  /\bcatalog_id:\s*Some\s*\(\s*model\.id\.clone\(\)\s*\)/u,
  'Started model summary catalogId must retain the stable selector',
);
const hostModelRefBody = typescriptFunctionBody(
  desktopRuntimeSource,
  /\bfunction\s+hostModelRef\b/u,
  'renderer hostModelRef',
);
const codexSelectorBranch = hostModelRefBody.indexOf("model?.api === 'codex-app-server'");
const genericModelBranch = hostModelRefBody.indexOf('if (!model?.id)');
assert.ok(codexSelectorBranch >= 0, 'renderer must recognize Codex Started model summaries');
assert.ok(
  genericModelBranch > codexSelectorBranch,
  'Codex selector checkpoint must run before generic provider/leaf model projection',
);
assert.match(
  hostModelRefBody,
  /return\s+`codex:\$\{model\.catalogId\.trim\(\)\}`/u,
  'Codex Started checkpoint must persist codex:<selector>, not openai/<leaf>',
);
const persistStartedIdentityBody = typescriptFunctionBody(
  desktopRuntimeSource,
  /\bexport\s+async\s+function\s+persistStartedNativeSessionIdentity\b/u,
  'renderer Started identity checkpoint',
);
assert.match(
  persistStartedIdentityBody,
  /const\s+actualModel\s*=\s*hostModelRef\s*\(\s*input\.event\.model\s*\)/u,
  'Started checkpoint must derive its persisted model through the selector-preserving projector',
);
assert.match(
  persistStartedIdentityBody,
  /actualModel\s*\?\s*\{\s*model:\s*actualModel\s*\}\s*:\s*\{\}/u,
  'Started checkpoint must save the selector-preserving runtime model ref',
);

const accountReadBody = structBody(rustHostProductionSource, 'NativeAccountReadResponse');
for (const field of ['requires_openai_auth', 'account']) {
  assert.match(accountReadBody, new RegExp(`\\b${field}\\s*:`, 'u'));
}
const rateLimitsBody = structBody(rustHostProductionSource, 'CodexRateLimitsResponse');
assert.match(rateLimitsBody, /\brate_limits\s*:/u);
const accountUsageBody = structBody(rustHostProductionSource, 'CodexAccountUsageResponse');
assert.match(accountUsageBody, /\bsummary\s*:/u);
for (const field of fixture.nativeShapes.rateLimits.nativeUsageFields) {
  assert.match(
    rustHostProductionSource,
    new RegExp(`\\b${camelToSnake(field)}\\s*:`, 'u'),
    `Rust native Usage contract must decode ${field}`,
  );
}
for (const field of fixture.nativeShapes.accountUsage.activityFields) {
  assert.match(
    rustHostProductionSource,
    new RegExp(`\\b${camelToSnake(field)}\\s*:`, 'u'),
    `Rust account token-activity contract must decode ${field}`,
  );
}

const accountSnapshotBody = functionBody(rustHostProductionSource, 'account_snapshot');
assert.match(accountSnapshotBody, /chatgpt_account_id\s*\(\s*fingerprint\s*,\s*email\s*\)/u);
assert.match(
  accountSnapshotBody,
  /available:\s*false[\s\S]*did not publish a stable account identity/u,
  'missing native ChatGPT identity must make the account unavailable',
);
const stableAccountIdBody = functionBody(rustHostProductionSource, 'stable_account_id');
assert.match(stableAccountIdBody, /"codex-subscription-\{\}"/u);
assert.match(stableAccountIdBody, /stable_hex\s*\(\s*seed\s*\)\s*\[\.\.24\]/u);
const chatgptAccountIdBody = functionBody(rustHostProductionSource, 'chatgpt_account_id');
assert.match(chatgptAccountIdBody, /email\.trim\(\)\.to_lowercase\(\)/u);
assert.match(
  chatgptAccountIdBody,
  /stable_account_id\s*\(\s*&format!\s*\(\s*"chatgpt\\0\{fingerprint\}\\0\{discriminator\}"/u,
  'opaque account ownership must bind Agent Home and normalized native account identity',
);
assert.doesNotMatch(
  statusResponseBody,
  /"email"\s*:/u,
  'native email must never appear in the product account projection',
);

const subscriptionUsageBody = functionBody(rustHostProductionSource, 'subscription_usage');
assert.equal(
  fixture.productProjection.subscriptionUsage.rateLimitSelection,
  'all-rateLimitsByLimitId-buckets-or-top-level-only-when-map-absent',
);
assert.match(
  subscriptionUsageBody,
  /rate_limits_by_limit_id[\s\S]*filter\s*\(\s*\|limits\|\s*!limits\.is_empty\(\)\s*\)/u,
  'native Usage must prefer a non-empty rateLimitsByLimitId map',
);
assert.match(
  subscriptionUsageBody,
  /for\s*\(\s*map_limit_id\s*,\s*rate\s*\)\s*in\s*by_limit_id/u,
  'native Usage must preserve every published rate-limit bucket',
);
assert.match(
  subscriptionUsageBody,
  /else\s*\{[\s\S]*let\s+rate\s*=\s*&rate_limits\.rate_limits/u,
  'top-level rateLimits may be used only when the native bucket map is absent or empty',
);
assert.doesNotMatch(
  subscriptionUsageBody,
  /(?:\.get\s*\(\s*"codex"\s*\)|\.values\(\)\.next\(\))/u,
  'Usage must not select one preferred or arbitrary bucket',
);
assert.match(subscriptionUsageBody, /rate\.credits\.as_ref\(\)/u);
assert.doesNotMatch(
  subscriptionUsageBody,
  /"credits"\s*:\s*reset_credits/u,
  'rate-limit reset credits must not be mislabeled as native subscription credit balance',
);
assert.match(
  subscriptionUsageBody,
  /rate_limit_reset_credits[\s\S]*available_count[\s\S]*SubscriptionUsageProjection[\s\S]*reset_credits,/u,
  'provider-issued reset credits must remain a separately named native Usage value',
);
const subscriptionProjectionBodies = [
  'SubscriptionUsageProjection',
  'SubscriptionLimitProjection',
  'SubscriptionWindowProjection',
]
  .map((name) => structBody(rustHostProductionSource, name))
  .join('\n');
for (const field of fixture.productProjection.subscriptionUsage.allowedFields) {
  assert.match(
    subscriptionProjectionBodies,
    new RegExp(`\\b${camelToSnake(field)}\\s*:`, 'u'),
    `Codex subscription Usage projection must carry ${field}`,
  );
}

requireLiteral(
  rustHostProductionSource,
  fixture.reasoningProjection.allowedSummaryNotification,
  'Codex safe reasoning projection',
);
assert.match(
  rustHostProductionSource,
  /"item\/reasoning\/summaryTextDelta"\s*=>\s*\{[\s\S]{0,500}project_stream_delta\s*\([\s\S]{0,180}"reasoning"[\s\S]{0,180}StreamProjectionKind::Reasoning/u,
  'native reasoning summaries must enter the stateful safe-stream projection',
);
const emitStreamProjectionBody = functionBody(rustHostProductionSource, 'emit_stream_projection');
assert.match(
  emitStreamProjectionBody,
  /StreamProjectionKind::Reasoning\s*=>\s*\{[\s\S]{0,180}append_reasoning\s*\(/u,
  'only redacted reasoning stream projections may enter product reasoning text',
);
requireLiteral(
  rustHostProductionSource,
  fixture.reasoningProjection.ignoredRawNotification,
  'Codex ignored notification list',
);
assert.doesNotMatch(
  rustHostProductionSource,
  /"item\/reasoning\/textDelta"\s*=>\s*\{/u,
  'raw reasoning text must never have a projection handler',
);

const nativeThreadRefBody = structBody(rustHostProductionSource, 'CodexNativeThreadRef');
assert.match(
  rustHostProductionSource,
  /#\[serde\(deny_unknown_fields\)\][\s\S]{0,160}struct\s+CodexNativeThreadRef\b/u,
  'opaque native session references must reject native path or future raw fields',
);
for (const field of ['protocol', 'thread_id', 'session_id']) {
  assert.match(nativeThreadRefBody, new RegExp(`\\b${field}\\s*:`, 'u'));
}
for (const forbidden of ['path', 'session_file', 'codex_home']) {
  assert.doesNotMatch(
    nativeThreadRefBody,
    new RegExp(`\\b${forbidden}\\s*:`, 'u'),
    `opaque native thread projection must not expose ${forbidden}`,
  );
}
const opaqueSessionIdBody = functionBody(rustHostProductionSource, 'opaque_session_id');
assert.match(opaqueSessionIdBody, /serde_json::to_string\s*\(\s*native\s*\)/u);
const resolveContinuationBody = functionBody(rustHostProductionSource, 'resolve_continuation');
assert.match(
  resolveContinuationBody,
  /\.map\s*\(\s*parse_continuation\s*\)\s*\.transpose\s*\(\s*\)/u,
);
const parseContinuationBody = functionBody(rustHostProductionSource, 'parse_continuation');
assert.match(
  parseContinuationBody,
  /serde_json::from_str::<CodexNativeThreadRef>\s*\(\s*value\s*\)/u,
);
assert.match(
  parseContinuationBody,
  /native\s*\.protocol\s*\.ne\s*\(\s*NATIVE_THREAD_PROTOCOL\s*\)|native\.protocol\s*!=\s*NATIVE_THREAD_PROTOCOL/u,
);
assert.match(
  parseContinuationBody,
  /native\.thread_id\.trim\(\)\.is_empty\(\)\s*\|\|\s*native\.session_id\.trim\(\)\.is_empty\(\)/u,
);
assert.match(
  rustHostProductionSource,
  /sha256_hex\s*\(\s*format!\s*\(\s*"codex-home\\0\{codex_home\}"/u,
  'CODEX_HOME may only cross the protocol boundary as a one-way fingerprint',
);
assert.doesNotMatch(
  rustHostProductionSource,
  /(?:File::open|read_to_string|read_dir|canonicalize)\s*\([^)]*(?:auth\.json|access[_A-Z]?token|refresh[_A-Z]?token)/iu,
  'Codex host must not read native auth files or raw tokens',
);
for (const forbidden of ['access_token', 'id_token', 'api_key', 'authorization']) {
  assert.doesNotMatch(
    rustHostProductionSource,
    new RegExp(`"${forbidden}"\\s*:`, 'iu'),
    `Codex host must not project raw secret field ${forbidden}`,
  );
}
for (const field of fixture.productProjection.forbiddenSecretOrNativeHomeFields) {
  const jsonKey = field.includes('.') ? field : field;
  const keyPattern = new RegExp(`"${escapeRegExp(jsonKey)}"\\s*:`, 'gu');
  const source =
    field === 'refreshToken'
      ? rustHostProductionSource.replace(/"refreshToken"\s*:\s*false/gu, '')
      : rustHostProductionSource;
  assert.doesNotMatch(source, keyPattern, `Codex product projection must never serialize ${field}`);
}

for (const pattern of [
  /Command::new\s*\(\s*"codex"\s*\)/u,
  /Command::new\s*\(\s*"codex-app-server"\s*\)/u,
  /\.arg\s*\(\s*"app-server"\s*\)/u,
  /\bwhich(?:::|\.)which\s*\(/u,
  /std::env::var_os\s*\(\s*"PATH"\s*\)/u,
]) {
  assert.doesNotMatch(
    rustHostProductionSource,
    pattern,
    'Codex host must never fall back to PATH/system CLI',
  );
}
assert.match(
  rustHostProductionSource,
  /Command::new\s*\(\s*binary\s*\)/u,
  'Codex host must spawn the already-resolved bundled binary path',
);

assert.match(
  taskBindingSource,
  /Opaque\s*\{\s*engine_id:\s*String,\s*account_id:\s*String,\s*billing_mode:\s*String,\s*id:\s*String,?\s*\}/su,
  'workspace resume authority must bind an opaque native session to its engine, account, and billing lane',
);
assert.match(
  taskBindingSource,
  /NativeSessionReference::Opaque\s*\{\s*engine_id:\s*"codex"\.into\(\),\s*account_id,\s*billing_mode,\s*id:\s*session_id,?/su,
  'Codex resume must produce an opaque thread id bound to the persisted subscription account',
);
assert.match(
  taskBindingSource,
  /interrupted Codex task must use an opaque native session identity without a session file/u,
);
assert.match(taskBindingSource, /session_file IS NULL/u);
assert.match(
  desktopRuntimeSource,
  /engineId\s*!==\s*'api'\s*&&\s*sessionFile/u,
  'renderer persistence must reject session files from opaque engines',
);

const publishBody = functionBody(rustHostProductionSource, 'publish');
assert.match(
  publishBody,
  /if\s+inner\.terminal\.is_some\(\)\s*\{\s*return\s+inner\.next_cursor\.saturating_sub\(1\)/u,
  'normal stream publication must reject every event after terminal commit',
);
const terminalizeBody = functionBody(rustHostProductionSource, 'terminalize_locked');
const terminalBufferIndex = terminalizeBody.indexOf('inner.events.push_back');
const terminalClaimIndex = terminalizeBody.indexOf('inner.terminal = Some(outcome)');
const subscriberTakeIndex = terminalizeBody.indexOf('std::mem::take(&mut inner.subscribers)');
assert.ok(terminalBufferIndex >= 0, 'terminal events must enter the replay buffer');
assert.ok(
  terminalClaimIndex > terminalBufferIndex,
  'terminal events and terminal authority must commit in one locked sequence',
);
assert.ok(
  subscriberTakeIndex > terminalClaimIndex,
  'terminal commit must close normal publication before subscribers are released',
);
const finishInterruptedBody = functionBody(rustHostProductionSource, 'finish_interrupted');
assert.match(finishInterruptedBody, /stop_reason:\s*Some\s*\(\s*"interrupted"\.into\(\)\s*\)/u);
assert.match(
  finishInterruptedBody,
  /terminalize_locked\s*\(\s*&mut\s+inner\s*,\s*RunOutcome::Interrupted/u,
  'interrupted terminal event and outcome must share the atomic terminalizer',
);
const abortBody = functionBody(rustHostProductionSource, 'abort_impl');
const stopClaimIndex = abortBody.indexOf('.finish_interrupted(');
const nativeInterruptIndex = abortBody.indexOf('"turn/interrupt"');
const waitNativeTerminalIndex = abortBody.indexOf('wait_outcome()');
const terminateIndex = abortBody.indexOf('.terminate().await');
assert.ok(nativeInterruptIndex >= 0, 'Stop must request native interruption');
assert.ok(
  waitNativeTerminalIndex > nativeInterruptIndex,
  'Stop must wait for the authoritative native terminal after requesting interruption',
);
assert.ok(
  terminateIndex > waitNativeTerminalIndex,
  'Stop may terminate the native host only after its bounded terminal wait expires',
);
assert.ok(
  stopClaimIndex > terminateIndex,
  'the local interrupted terminal is a timeout fallback after the native host is disabled',
);
assert.equal(fixture.runLifecycle.nativeInterruptedTerminalIsAuthoritative, true);
assert.equal(fixture.runLifecycle.localInterruptedTerminalOnlyAfterInterruptTimeout, true);

assert.deepEqual(fixture.runLifecycle.subscriberDelivery, {
  order: 'buffer-commit-order',
  serialization: 'shared-normal-and-terminal-barrier',
  eventsOrCursorsAfterTerminal: false,
  terminalCursorDelivery: 'before-terminal-event',
  requiredConcurrencyTests: [
    'late_native_output_is_rejected_after_user_stop',
    'publish_delivery_cannot_arrive_after_terminal_delivery',
  ],
});
const runStreamBody = structBody(rustHostProductionSource, 'RunStream');
assert.match(
  runStreamBody,
  /\bdelivery(?:_order|_lock|_gate)?:\s*Mutex<\(\)>/u,
  'RunStream must own an independent subscriber-delivery serialization barrier',
);
function assertDeliveryBarrierCovers(body, commitPattern, deliveryPattern, label) {
  const barrierMatch = body.match(
    /(?:self\.delivery(?:_order|_lock|_gate)?\.lock|self\.delivery_guard)\s*\(/u,
  );
  assert.ok(barrierMatch?.index !== undefined, `${label} must acquire the shared delivery barrier`);
  const commitMatch = body.match(commitPattern);
  assert.ok(commitMatch?.index !== undefined, `${label} must commit its buffered event`);
  const deliveryMatch = body.match(deliveryPattern);
  assert.ok(deliveryMatch?.index !== undefined, `${label} must deliver its committed event`);
  assert.ok(
    barrierMatch.index < commitMatch.index && commitMatch.index < deliveryMatch.index,
    `${label} must hold one delivery order from buffer commit through Channel delivery`,
  );
}
assertDeliveryBarrierCovers(
  publishBody,
  /inner\.events\.push_back/u,
  /channel\.send/u,
  'normal stream publication',
);
for (const [name, label] of [
  ['finish_completed', 'completed terminal publication'],
  ['finish_interrupted', 'interrupted terminal publication'],
  ['finish_failed', 'failed terminal publication'],
]) {
  assertDeliveryBarrierCovers(
    functionBody(rustHostProductionSource, name),
    /terminalize_locked/u,
    /deliver_terminal_events/u,
    label,
  );
}
const terminalDeliveryBody = functionBody(rustHostProductionSource, 'deliver_terminal_events');
assert.match(
  terminalDeliveryBody,
  /send_buffered_entry\s*\(\s*&channel\s*,\s*entry\s*\)/u,
  'terminal delivery must use the same cursor/event ordering primitive as replay',
);
const bufferedDeliveryBody = functionBody(rustHostProductionSource, 'send_buffered_entry');
const terminalCursorIndex = bufferedDeliveryBody.indexOf('channel.send(cursor)');
const terminalEventIndex = bufferedDeliveryBody.indexOf('channel.send(entry.event.clone())');
const normalEventIndex = bufferedDeliveryBody.lastIndexOf('channel.send(entry.event.clone())');
const normalCursorIndex = bufferedDeliveryBody.lastIndexOf('channel.send(cursor)');
assert.ok(
  terminalCursorIndex >= 0 && terminalCursorIndex < terminalEventIndex,
  'a terminal event cursor must be delivered before the terminal event itself',
);
assert.ok(
  normalEventIndex >= 0 && normalEventIndex < normalCursorIndex,
  'a non-terminal event keeps normal event-then-cursor delivery order',
);
const terminalClassifierBody = functionBody(rustHostProductionSource, 'is_terminal_event');
for (const terminalVariant of ['MessageEnd', 'Result', 'Error']) {
  assert.match(
    terminalClassifierBody,
    new RegExp(`CodexAgentHostEvent::${terminalVariant}\\b`, 'u'),
    `${terminalVariant} must never be followed by its cursor`,
  );
}
const reattachBody = functionBody(rustHostProductionSource, 'reattach');
const reattachBarrierIndex = reattachBody.search(
  /(?:self\.delivery(?:_order|_lock|_gate)?\.lock|self\.delivery_guard)\s*\(/u,
);
const replayDeliveryIndex = reattachBody.search(/channel\s*\.send/u);
const liveSubscriptionIndex = reattachBody.indexOf('inner.subscribers.insert');
assert.ok(
  reattachBarrierIndex >= 0 &&
    replayDeliveryIndex > reattachBarrierIndex &&
    liveSubscriptionIndex > replayDeliveryIndex,
  'reattach must replay buffered order and join live delivery under the same barrier',
);
for (const testName of fixture.runLifecycle.subscriberDelivery.requiredConcurrencyTests) {
  assert.match(
    rustHostSource,
    new RegExp(`#\\[test\\][\\s\\S]{0,160}fn\\s+${testName}\\b`, 'u'),
    `Rust concurrency contract test ${testName} must exist and run under cargo test`,
  );
}

assert.deepEqual(fixture.runLifecycle.frozenExecutionSelection, {
  modelSource: 'gateway-runtimeModelRef',
  employeeBindingMayOverride: ['thinkingLevel'],
  employeeBindingMayNotOverride: ['model', 'executionTarget'],
});
assert.deepEqual(fixture.runLifecycle.nativePlan, {
  permissionMode: 'plan',
  planCollaborationMode: 'plan',
  nonPlanCollaborationMode: 'default',
  defaultReasoningEffort: 'medium',
  settingsFieldCase: 'snake_case',
  authoritativeItemType: 'plan',
  streamChannel: 'plan',
  workspaceMutationAllowed: false,
});
const permissionPolicyBody = functionBody(rustHostProductionSource, 'permission_policy');
assert.match(
  permissionPolicyBody,
  /"plan"\s*=>[\s\S]*thread_sandbox:\s*"read-only"[\s\S]*approval_policy:\s*json!\("never"\)[\s\S]*"type":\s*"readOnly"[\s\S]*native_collaboration_mode:\s*"plan"/u,
  'Plan must bind native Plan collaboration semantics to a read-only, never-approve sandbox',
);
for (const mode of ['ask', 'auto', 'full']) {
  assert.match(
    permissionPolicyBody,
    new RegExp(`"${mode}"\\s*=>[\\s\\S]*?native_collaboration_mode:\\s*"default"`, 'u'),
    `${mode} must explicitly clear sticky native Plan state`,
  );
}
const nativeCollaborationBody = functionBody(rustHostProductionSource, 'turn_collaboration_mode');
for (const field of ['reasoning_effort', 'developer_instructions']) {
  requireLiteral(nativeCollaborationBody, field, 'native collaboration settings');
}
assert.match(
  nativeCollaborationBody,
  /native_collaboration_mode\s*==\s*"plan"[\s\S]*then_some\("medium"\)/u,
  'native Plan must use Codex medium effort when the user did not choose one',
);
assert.match(
  startNativeTurnBody,
  /"collaborationMode"\s*:\s*collaboration_mode/u,
  'every native turn must explicitly send its collaboration mode',
);
const projectItemBody = functionBody(rustHostProductionSource, 'project_item');
assert.match(
  projectItemBody,
  /"plan"\s*=>[\s\S]*set_completed_plan/u,
  'the completed native Plan item must become the authoritative answer',
);
assert.match(
  rustHostProductionSource,
  /"item\/plan\/delta"\s*=>\s*\{[\s\S]{0,500}project_stream_delta\s*\([\s\S]{0,180}"plan"[\s\S]{0,180}StreamProjectionKind::Plan/u,
  'native Plan deltas must enter the stateful safe-stream projection',
);
assert.match(
  emitStreamProjectionBody,
  /StreamProjectionKind::Plan\s*=>\s*\{[\s\S]{0,220}append_plan_delta[\s\S]{0,220}channel:\s*Some\("plan"\.into\(\)\)/u,
  'redacted native Plan deltas must use a distinct product plan channel',
);
const finishCompletedBody = functionBody(rustHostProductionSource, 'finish_completed');
assert.match(
  finishCompletedBody,
  /plan_text\.trim\(\)\.is_empty\(\)[\s\S]*plan_text\.clone\(\)/u,
  'completed native Plan text must override wrapper/final-message transport text',
);
const runNativeTurnBody = typescriptFunctionBody(
  desktopRuntimeSource,
  /\bprivate\s+async\s+runNativeTurn\b/u,
  'DesktopNativeAgentRuntime.runNativeTurn',
);
assert.match(
  runNativeTurnBody,
  /resolvedThinkingLevel\s*=\s*runtimeSelection\.thinkingLevel/u,
  'employee binding may still supply its thinking level',
);
assert.doesNotMatch(
  runNativeTurnBody,
  /resolvedModel\s*=\s*runtimeSelection\.model/u,
  'employee binding must never replace the gateway-frozen runtime model',
);
assert.match(
  runNativeTurnBody,
  /const\s+exactTarget\s*=\s*validateExecutionTarget\s*\(\s*input\.executionTarget\s*\)[\s\S]*const\s+exactRuntimeModelRef\s*=\s*input\.runtimeModelRef\?\.trim\(\)[\s\S]*executionTarget\s*=\s*exactTarget[\s\S]*resolvedModel\s*=\s*exactRuntimeModelRef/u,
  'adapter execution must consume the exact gateway-frozen target and selector without reselecting',
);

for (const command of fixture.commands) {
  assert.match(
    tauriLibSource,
    new RegExp(`\\b${command}\\b`, 'u'),
    `Tauri invoke handler must register ${command}`,
  );
  assert.match(
    commandRegistrySource,
    new RegExp(`\\b${command}\\s*:`, 'u'),
    `renderer command registry must declare ${command}`,
  );
}

for (const forbiddenCost of fixture.productProjection.subscriptionUsage.forbiddenCostFields) {
  assert.doesNotMatch(
    rustHostProductionSource,
    new RegExp(forbiddenCost, 'iu'),
    `Codex subscription runtime must not emit or derive ${forbiddenCost}`,
  );
}
assert.match(
  statusResponseBody,
  /"cost"\s*:\s*unavailable_capability\s*\(\s*"Subscription usage is not converted into API cost\."\s*\)/u,
  'Codex subscription account capability must mark Cost unavailable without inference',
);
assert.match(sharedAccountSource, /kind:\s*'subscription'/u);
assert.match(sharedAccountSource, /source:\s*'native'/u);
assert.match(
  sharedAccountSource,
  /Provider-issued rate-limit reset credits, distinct from plan credit balance/u,
  'shared contract must keep reset-credit allowances distinct from plan credit balance',
);
assert.match(
  sharedAccountSource,
  /subscription[\s\S]{0,100}(?:tokens|activity)[\s\S]{0,40}(?:is|are) never converted to (?:API )?cost/u,
  'shared subscription Usage contract must state the no-cost-inference boundary',
);
assert.match(
  aiAccountsPaneSource,
  /if\s*\(account\.billingMode\s*===\s*'subscription'\)\s*return\s+account/u,
  'subscription accounts must bypass API accounting snapshots',
);
assert.doesNotMatch(
  aiAccountsPaneSource,
  /off-set-provider-summary-grid|function\s+usageHeadline\s*\(/u,
  'Settings must not duplicate Usage or Cost in an account summary grid',
);
assert.match(
  aiAccountsPaneSource,
  /selectedAccount\.billingMode\s*===\s*'api'\s*\?\s*\([\s\S]{0,300}<CapsLabel>Cost<\/CapsLabel>/u,
  'Settings detail must render Cost only inside the API-account branch',
);
assert.match(
  aiAccountsPaneSource,
  /usage\.limits[\s\S]*limit\.credits[\s\S]*\{limit\.label\}\s*·\s*Credits[\s\S]*usage\.resetCredits[\s\S]*Rate-limit reset credits/u,
  'Settings must label plan credits and rate-limit reset credits separately',
);

assert.equal(
  packageJson.scripts?.['harness:codex-app-server-contract'],
  'node scripts/harness-codex-app-server-contract.mjs && pnpm harness:codex-runtime-conformance',
  'the Codex contract gate must include executable Rust runtime conformance',
);
assert.equal(
  packageJson.scripts?.['prepare:desktop-cargo-test'],
  'node scripts/prepare-desktop-cargo-test.mjs',
  'root package must prepare inert generated resources before direct cargo tests',
);
assert.match(
  cargoTestPrepSource,
  /codex-app-server-aarch64-apple-darwin/u,
  'clean-checkout cargo tests need an inert ignored Codex externalBin placeholder',
);
assert.equal(
  packageJson.scripts?.['harness:codex-runtime-conformance'],
  'pnpm prepare:desktop-cargo-test && cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml codex_agent_host:: --lib',
  'root package must expose the deterministic Codex runtime conformance suite',
);

console.log(
  `PASS Codex app-server contract (${fixture.artifact.releaseTag}, ${rustHostFiles.length} Rust host files, ${fixture.commands.length} commands)`,
);
