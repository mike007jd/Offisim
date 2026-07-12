import { spawnSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { RUN_FAILURE_KINDS, classifyRunFailure } from './pi-agent-host-wire.mjs';

function readJson(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'), { trailingCommas: true }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseHostResult(stdout, label) {
  for (const line of stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.kind === 'result') return event;
  }
  throw new Error(`${label} did not emit a result line`);
}

function runHost(scriptPath, payload, label) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return parseHostResult(result.stdout, label);
}

function ensureBundledHost(scriptPath) {
  if (existsSync(scriptPath)) return;

  console.log(`[harness:pi-agent-host] rebuilding missing bundle ${scriptPath}`);
  const result = spawnSync(process.execPath, ['scripts/build-pi-agent-host.mjs'], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Failed to start Pi Agent host bundle build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Pi Agent host bundle build failed (exit ${result.status ?? 'unknown'}${result.signal ? `, signal ${result.signal}` : ''})`,
    );
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`Pi Agent host bundle build succeeded but did not create ${scriptPath}`);
  }
}

const HOST_SCRIPT = 'scripts/tauri-pi-agent-host.entry.mjs';
const BUNDLED_HOST_SCRIPT = 'apps/desktop/src-tauri/resources/pi-agent-host.mjs';
ensureBundledHost(BUNDLED_HOST_SCRIPT);
const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');
const rustHostSource = globSync('apps/desktop/src-tauri/src/pi_agent_host/*.rs')
  .sort()
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const nodeHostSource = readFileSync(HOST_SCRIPT, 'utf8');
const bundledNodeHostSource = readFileSync(BUNDLED_HOST_SCRIPT, 'utf8');
const mcpBridgeSource = readFileSync('scripts/pi-mcp-bridge-extension.mjs', 'utf8');
const childSupervisorSource = readFileSync('scripts/pi-child-supervisor.mjs', 'utf8');
const delegationExtensionSource = readFileSync('scripts/pi-delegation-extension.mjs', 'utf8');
const wireSource = readFileSync('scripts/pi-agent-host-wire.mjs', 'utf8');
const executePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn sidecar_payload'),
  rustHostSource.indexOf('/// Build the Prompt Enhance sidecar payload'),
);
const collaboratePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn collaborate_payload'),
  rustHostSource.indexOf('/// Write the execute/status payload'),
);
const desktopRuntimeScopeSource = readFileSync(
  'apps/desktop/renderer/src/data/employee-persona.ts',
  'utf8',
);

assert(
  rootPackage.scripts['build:pi-agent-host'] === 'node scripts/build-pi-agent-host.mjs',
  'root package must build the Pi Agent host',
);
assert(!('provider:check' in rootPackage.scripts), 'provider:check must not be a validation gate');
assert(
  rootPackage.scripts.validate.includes('pnpm harness:pi-agent-host'),
  'validate must include the Pi Agent host harness',
);
assert(
  rootPackage.scripts['check:pi-wire-contract'] === 'node scripts/check-pi-wire-contract.mjs',
  'root package must run the Pi Agent wire-contract gate',
);
assert(
  rootPackage.scripts.validate.includes('pnpm check:pi-wire-contract'),
  'validate must include the Pi Agent wire-contract gate',
);
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host',
);
assert(
  !desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host') &&
    !desktopPackage.scripts['build:frontend'].includes('build:codex-agent-host'),
  'desktop build must not bundle Claude/Codex sidecars',
);
assert(
  tauriConfig.bundle.resources.includes('resources/pi-agent-host.mjs'),
  'release bundle must include the Pi Agent host',
);
assert(
  !tauriConfig.bundle.resources.some((resource) => /claude|codex/u.test(resource)),
  'release bundle must not include Claude/Codex sidecar resources',
);
assert(
  /pub struct PiAgentExecuteRequest[\s\S]*mcp_tools: Option<serde_json::Value>/.test(
    rustHostSource,
  ),
  'execute request must deserialize mcpTools so Office runs can receive employee MCP grants',
);
assert(
  /fn sidecar_payload\([\s\S]*agent_dir: Option<&Path>[\s\S]*"mode": "execute"[\s\S]*"mcpTools": req\.mcp_tools/.test(
    executePayloadSource,
  ),
  'execute sidecar payload must be AppHandle-free and forward mcpTools to the Node Pi host',
);
assert(
  /"projectId": req\.project_id/.test(executePayloadSource),
  'execute sidecar payload must forward projectId so delegation child runs inherit the project scope (a dropped projectId crashed the Node host with "projectId is not defined")',
);
assert(
  /"employeeId": req\.employee_id/.test(executePayloadSource),
  'execute sidecar payload must forward employeeId so publish-artifact and mission-bridge events keep employee attribution',
);
assert(
  !/"companyId": req\.company_id/.test(executePayloadSource),
  'execute sidecar payload must not emit companyId because the Node execute host has no companyId consumer',
);
assert(
  /fn collaborate_payload\([\s\S]*agent_dir: Option<&Path>/.test(collaboratePayloadSource) &&
    !/"companyId": req\.company_id|"capabilityProfile": req\.capability_profile/.test(
      collaboratePayloadSource,
    ),
  'collaboration payload must be AppHandle-free and omit companyId/capabilityProfile fields that the Node host does not consume',
);
assert(
  /payload = decodePiRequestPayload\(payload\)/.test(nodeHostSource) &&
    /export function decodePiRequestPayload/.test(wireSource),
  'the production Node entrypoint must pass execute/enhance/collaborate payloads through the shared request decoder',
);
assert(
  /const projectId = asNonEmptyString\(payload\.projectId\)/.test(nodeHostSource),
  'execute host must declare projectId from the run payload before delegating (a bare projectId reference throws "projectId is not defined")',
);
assert(
  /const projectId = asNonEmptyString\w*\(payload\.projectId\)/.test(bundledNodeHostSource),
  'bundled Pi Agent host must also declare projectId from the run payload — rebuild with pnpm build:pi-agent-host',
);
assert(
  /const baseTools = toolAllowlistForMode\(permissionMode\)/.test(nodeHostSource) &&
    /const scopedMcpTools =[\s\S]*permissionMode === 'plan'[\s\S]*mcpTools\.filter\(\(tool\) => !isWriteMcpTool\(tool\)\)[\s\S]*: mcpTools/.test(
      nodeHostSource,
    ) &&
    /const mcpHasCatalog = scopedMcpTools\.length > 0/.test(nodeHostSource) &&
    /const tools = \[[\s\S]*\.\.\.\(baseTools \?\? \['read', 'write', 'edit', 'bash'\]\)[\s\S]*'mcp_search_tools',[\s\S]*'mcp_describe_tool',[\s\S]*\.\.\.\(mcpHasCatalog \? \['mcp_call'\] : \[\]\)/.test(
      nodeHostSource,
    ),
  'execute host must always expose MCP discovery (mcp_search_tools/mcp_describe_tool) in the explicit tool allowlist, gate mcp_call on a non-empty grant catalog, and filter write MCP in plan mode',
);
assert(
  /No MCP tools are granted to you yet/.test(mcpBridgeSource) &&
    /No MCP tools are granted to you yet/.test(bundledNodeHostSource),
  'source and bundled MCP bridge must return an actionable "no tools granted" setup state for an empty catalog (screenshot-1 apology fix) — rebuild the bundle with pnpm build:pi-agent-host',
);
assert(
  /const scopedGrants = grants\.filter/.test(desktopRuntimeScopeSource) &&
    /requestSurface:\s*[\s\S]*server\.requestSurface[\s\S]*: 'settings'/.test(
      desktopRuntimeScopeSource,
    ) &&
    /if \(!server\) \{[\s\S]*continue;[\s\S]*\}/.test(desktopRuntimeScopeSource) &&
    /catch \{[\s\S]*return \[\];[\s\S]*\}/.test(desktopRuntimeScopeSource),
  'desktop buildMcpScope must connect registered MCP servers with their approved surface and expose only ready tools',
);
assert(
  /PI_HOST_PROTOCOL_VERSION = 6/.test(wireSource) &&
    /PI_HOST_PROTOCOL_VERSION: u32 = 6/.test(rustHostSource) &&
    /'worktreeCall'/.test(wireSource) &&
    /WorktreeCall/.test(rustHostSource) &&
    /'verifyCall'/.test(wireSource) &&
    /VerifyCall/.test(rustHostSource),
  'F2 must keep the Pi host wire version current and decode worktreeCall on both Node and Rust sides',
);
assert(
  /createWorktreeCallChannel/.test(nodeHostSource) &&
    /createWorkspaceLeaseManager/.test(nodeHostSource) &&
    /leaseManager/.test(nodeHostSource) &&
    /now:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /newId:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /confirmIntegration/.test(nodeHostSource),
  'execute host must run the workspace lease manager host-side and gate integration review',
);
assert(
  /handle_worktree_call/.test(rustHostSource) &&
    /run_git_validated/.test(rustHostSource) &&
    /write_worktree_result/.test(rustHostSource),
  'Rust Pi host must intercept worktreeCall and answer with worktreeResult through stdin',
);
{
  // The Task Board recognizes the in-chat review approval card ONLY by its title
  // string; if either side drifts, the board silently bypasses the live approval
  // and double-drives the lease pipeline. Lock the literal on both sides.
  const leaseActionsSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/tasks/workspace-lease-actions.ts',
    'utf8',
  );
  assert(
    nodeHostSource.includes('`Review delegated work ${mergeable[0]?.leaseId'),
    'execute host must title the integration approval "Review delegated work <leaseId>" — the Task Board matches this exact title',
  );
  assert(
    leaseActionsSource.split('`Review delegated work ${row.leaseId}`').length === 3,
    'workspace-lease-actions must match the approval card by the exact "Review delegated work <leaseId>" title in both review and request-changes paths',
  );
}
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(nodeHostSource) &&
    /normalizePiErrorMessage/.test(nodeHostSource) &&
    /code:\s*'upstream'/.test(nodeHostSource),
  'execute host must surface Pi model error stops as upstream failures instead of empty completed replies',
);
assert(
  /get rootModel\(\)[\s\S]*return effectiveRootModel/.test(nodeHostSource) &&
    /effectiveRootModel = session\.model \?\? model/.test(nodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(nodeHostSource) &&
    /function resolveEmployeeBinding\(employee\)/.test(childSupervisorSource) &&
    /ctx\.resolveModel\(requestedModel\)/.test(childSupervisorSource) &&
    /thinkingLevel = requestedThinking \?\? ctx\.rootThinkingLevel/.test(childSupervisorSource) &&
    /\.\.\.\(thinkingLevel \? \{ thinkingLevel \} : \{\}\)/.test(childSupervisorSource),
  'delegated children must inherit the parent run model unless an employee model override is provided',
);
assert(
  /selectedModel\(modelRegistry, requested\)/.test(nodeHostSource) &&
    /delete rest\.model/.test(nodeHostSource) &&
    /delete rest\.thinkingLevel/.test(nodeHostSource),
  'execute host must strip stale employee model/thinking bindings before the roster reaches delegation',
);
assert(
  /function resolveEmployeeBinding\(employee\)/.test(bundledNodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(bundledNodeHostSource) &&
    /thinkingLevel:\s*thinkingLevel2/.test(bundledNodeHostSource) &&
    /selectedModel\(modelRegistry2, requested\)/.test(bundledNodeHostSource),
  'bundled Pi Agent host must carry employee model/thinking binding and stale-binding filtering',
);
assert(
  /"roster": req\.roster/.test(executePayloadSource) &&
    /const model = e\.model\?\.trim\(\)/.test(desktopRuntimeScopeSource) &&
    /model && thinkingLevel \? \{ thinkingLevel \} : \{\}/.test(desktopRuntimeScopeSource),
  'employee model/thinking fields must cross renderer roster projection and opaque Rust roster forwarding',
);
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(childSupervisorSource) &&
    /Child completed without assistant output/.test(childSupervisorSource),
  'delegated children must fail provider errors and empty outputs instead of reporting completed no-output work',
);
assert(
  /an Orchestrator must never delegate a task to itself/.test(nodeHostSource) &&
    /Executors are/.test(nodeHostSource) &&
    /Use a Reviewer for independent diff review/.test(nodeHostSource) &&
    /entry\.displayTitle/.test(delegationExtensionSource),
  'delegation guidance must expose and enforce Orchestrator / Executor / Reviewer responsibilities',
);
assert(
  /providerStatusById/.test(nodeHostSource) &&
    /configuredProviderStatus/.test(nodeHostSource) &&
    /providerStatusById/.test(bundledNodeHostSource) &&
    /configuredProviderStatus/.test(bundledNodeHostSource),
  'source and bundled Pi Agent hosts must expose configured provider fallback for malformed registry entries',
);
// Typed failure kinds (I1): the supervisor may only emit run.failed through the
// blocked()/failed() helpers, which validate the typed failureKind at the emit
// boundary (assertRunFailureKind throws on a missing/unknown kind) — no failure
// path can forget it, and nothing downstream keyword-parses the summary. Lock
// the mechanism (exactly two helper-owned emits, each validated), not per-site
// payload shapes.
const supervisorRunFailedEmits =
  childSupervisorSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  supervisorRunFailedEmits.length === 2 &&
    supervisorRunFailedEmits.every((payload) => payload.includes('failureKind')) &&
    /function failed\(emit\w*, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ) &&
    /function blocked\(emit\w*, reason, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ),
  'child supervisor must route every run.failed through the validated blocked()/failed() helpers',
);
// The emit-boundary validator and the emitter-side classifier are behaviorally
// checked here (the wire module is dependency-free, safe to import).
assert(
  RUN_FAILURE_KINDS.length === 6 &&
    ['token', 'budget', 'permission', 'context', 'runtime', 'tool'].every((kind) =>
      RUN_FAILURE_KINDS.includes(kind),
    ),
  'RUN_FAILURE_KINDS must mirror the six-kind RunFailureKind union',
);
for (const [message, expected] of [
  ['maximum context length exceeded: 131072 tokens', 'context'],
  ['prompt is too long for the model window', 'context'],
  ['rate limit reached (429), retry later', 'token'],
  ['insufficient token quota for this request', 'token'],
  ['permission denied by provider policy', 'permission'],
  ['401 unauthorized', 'permission'],
  ['provider disconnected mid-stream', 'runtime'],
  ['', 'runtime'],
]) {
  assert(
    classifyRunFailure(message) === expected,
    `classifyRunFailure(${JSON.stringify(message)}) must be '${expected}', got '${classifyRunFailure(message)}'`,
  );
}
// The bundler may suffix-rename identifiers (emit2, …); match loosely.
const bundledRunFailedEmits =
  bundledNodeHostSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  bundledRunFailedEmits.length === 2 &&
    bundledRunFailedEmits.every((payload) => payload.includes('failureKind')),
  'bundled Pi Agent host must route run.failed through the typed-failureKind helpers — rebuild with pnpm build:pi-agent-host',
);

const tempAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-host-'));
writeFileSync(
  join(tempAgentDir, 'models.json'),
  `{
    // Pi models.json accepts JSONC comments and trailing commas.
    "providers": {
      "local-test": {
        "name": "Local Test",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "test",
        "headers": { "x-keep": "provider" },
        "compat": { "mode": "fixture" },
        "authHeader": true,
        "models": [
          {
            "id": "fixture-model",
            "name": "Fixture Model",
            "api": "openai-completions",
            "contextWindow": 2048,
            "maxTokens": 512,
            "headers": { "x-keep": "model" },
            "compat": { "modelMode": "fixture" },
          },
        ],
        "modelOverrides": {
          "builtin-model": { "name": "Fixture override" },
        },
      },
    },
  }`,
);

let result;
try {
  result = runHost(HOST_SCRIPT, { mode: 'status', agentDir: tempAgentDir }, 'Pi Agent status host');
  assert(result.response?.ok === true, 'Pi Agent status response must be ok');
  assert(
    Array.isArray(result.response.availableModels),
    'Pi Agent status response must include availableModels from Pi ModelRegistry',
  );
  assert(
    result.response.paths?.modelsPath,
    'Pi Agent status response must expose Pi models.json path',
  );
  assert(
    result.response.modelsConfig?.exists === true &&
      result.response.modelsConfig.providers.includes('local-test') &&
      result.response.modelsConfig.modelCount === result.response.allModelCount &&
      !result.response.modelsConfig.parseError,
    'Pi Agent status response must expose the Pi ModelRegistry-loaded models.json summary',
  );
  assert(
    result.response.configuredProviderStatus?.some((account) => account.provider === 'local-test'),
    'Pi Agent status response must expose configuredProviderStatus for the editable provider list',
  );
  assert(
    result.response.providerStatus.length > result.response.configuredProviderStatus.length,
    'configuredProviderStatus must not be the full built-in provider catalog',
  );
  const editableLocalProvider = result.response.providerConfigs?.find(
    (provider) => provider.provider === 'local-test',
  );
  assert(
    editableLocalProvider?.displayName === 'Local Test' &&
      editableLocalProvider.baseUrl === 'http://127.0.0.1:11434/v1' &&
      editableLocalProvider.api === 'openai-completions' &&
      editableLocalProvider.hasApiKey === true &&
      editableLocalProvider.models?.[0]?.contextWindow === 2048 &&
      editableLocalProvider.models?.[0]?.maxTokens === 512,
    'Pi Agent status response must expose editable models.json provider config without raw keys',
  );
  assert(
    !JSON.stringify(editableLocalProvider).includes('apiKey'),
    'Pi Agent status editable provider config must not echo raw API keys',
  );
  const openAiTemplate = result.response.providerTemplates?.find(
    (template) => template.provider === 'openai',
  );
  assert(
    openAiTemplate?.models?.length > 0 &&
      typeof openAiTemplate.baseUrl === 'string' &&
      openAiTemplate.configured === false,
    'Pi Agent status response must expose add-provider templates from the Pi registry',
  );
  const invalidAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-invalid-'));
  try {
    writeFileSync(
      join(invalidAgentDir, 'models.json'),
      `{
        "providers": {
          "broken-local": {
            "name": "Broken Local",
            "baseUrl": "http://127.0.0.1:11434/v1",
            "api": "openai-completions",
            "apiKey": "test",
            "authHeader": "invalid-for-pi-schema",
            "models": [{ "id": "broken-model" }]
          }
        }
      }`,
    );
    for (const scriptPath of [HOST_SCRIPT, BUNDLED_HOST_SCRIPT]) {
      const invalidResult = runHost(
        scriptPath,
        { mode: 'status', agentDir: invalidAgentDir },
        `Pi Agent invalid-schema status host (${scriptPath})`,
      );
      assert(
        invalidResult.response.modelsConfig?.parseError &&
          invalidResult.response.providerConfigs?.some(
            (provider) => provider.provider === 'broken-local',
          ) &&
          invalidResult.response.configuredProviderStatus?.some(
            (provider) => provider.provider === 'broken-local',
          ),
        'Pi Agent status must keep models.json providers editable even when Pi ModelRegistry reports a schema error',
      );
    }
  } finally {
    rmSync(invalidAgentDir, { recursive: true, force: true });
  }
  assert(
    !/function stripJsoncComments/.test(nodeHostSource) &&
      !/function parseJsonc/.test(nodeHostSource),
    'Pi Agent host must not duplicate Pi ModelRegistry JSONC parsing',
  );

  runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'local-test',
        displayName: 'Local Test Edited',
        baseUrl: 'http://127.0.0.1:11434/v2',
        api: 'openai-completions',
        apiKey: '',
        keepExistingApiKey: true,
        models: [
          {
            id: 'fixture-model',
            name: 'Fixture Model Edited',
            api: 'openai-responses',
            contextWindow: 4096,
            maxTokens: 1024,
          },
        ],
      },
    },
    'Pi Agent saveProvider keep-key edit',
  );
  let modelsRoot = readJson(join(tempAgentDir, 'models.json'));
  let localProvider = modelsRoot.providers['local-test'];
  assert(
    localProvider.name === 'Local Test Edited' &&
      localProvider.baseUrl === 'http://127.0.0.1:11434/v2' &&
      localProvider.apiKey === 'test' &&
      localProvider.headers['x-keep'] === 'provider' &&
      localProvider.compat.mode === 'fixture' &&
      localProvider.authHeader === true &&
      localProvider.modelOverrides['builtin-model'].name === 'Fixture override',
    'Pi Agent saveProvider must preserve provider-level unknown fields and keep an existing API key when blank',
  );
  assert(
    localProvider.models[0].name === 'Fixture Model Edited' &&
      localProvider.models[0].api === 'openai-responses' &&
      localProvider.models[0].contextWindow === 4096 &&
      localProvider.models[0].maxTokens === 1024 &&
      localProvider.models[0].headers['x-keep'] === 'model' &&
      localProvider.models[0].compat.modelMode === 'fixture',
    'Pi Agent saveProvider must update editable model fields while preserving model-level unknown fields',
  );

  runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'local-test',
        displayName: 'Local Test Edited',
        baseUrl: 'http://127.0.0.1:11434/v2',
        api: 'openai-completions',
        apiKey: 'replacement-key',
        keepExistingApiKey: true,
        models: [{ id: 'fixture-model', name: 'Fixture Model Edited' }],
      },
    },
    'Pi Agent saveProvider key replacement',
  );
  modelsRoot = readJson(join(tempAgentDir, 'models.json'));
  localProvider = modelsRoot.providers['local-test'];
  assert(
    localProvider.apiKey === 'replacement-key',
    'Pi Agent saveProvider must replace an existing API key when a new key is entered',
  );
  assert(
    localProvider.models[0].name === 'Fixture Model Edited' &&
      !('api' in localProvider.models[0]) &&
      !('contextWindow' in localProvider.models[0]) &&
      !('maxTokens' in localProvider.models[0]) &&
      localProvider.models[0].headers['x-keep'] === 'model' &&
      localProvider.models[0].compat.modelMode === 'fixture',
    'Pi Agent saveProvider must allow editable model fields to be cleared while preserving unknown model fields',
  );

  const saveResult = runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'custom-jsonc',
        displayName: 'Custom JSONC',
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        apiKey: 'test',
        keepExistingApiKey: false,
        models: [{ id: 'custom-model', name: 'Custom Model' }],
      },
    },
    'Pi Agent saveProvider host',
  );
  assert(saveResult.response?.ok === true, 'Pi Agent saveProvider response must be ok');
  assert(
    saveResult.response.modelsConfig?.providers.includes('custom-jsonc') &&
      saveResult.response.availableModels.some(
        (model) => model.provider === 'custom-jsonc' && model.id === 'custom-model',
      ),
    'Pi Agent saveProvider must preserve JSONC-readable models.json and expose the saved provider',
  );
  assert(
    readFileSync(join(tempAgentDir, 'models.json'), 'utf8').includes(
      '// Pi models.json accepts JSONC comments and trailing commas.',
    ),
    'Pi Agent saveProvider must preserve existing JSONC comments while editing a provider',
  );
} finally {
  rmSync(tempAgentDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      host: 'pi-agent',
      availableModels: result.response.availableModels.length,
      allModelCount: result.response.allModelCount,
      modelsConfig: result.response.modelsConfig,
    },
    null,
    2,
  ),
);
