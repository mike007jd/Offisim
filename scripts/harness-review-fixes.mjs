#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

async function source(path) {
  return readFile(resolve(ROOT, path), 'utf8');
}

async function exists(path) {
  try {
    await access(resolve(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludesAll(text, fragments, message) {
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${message} Missing fragment: ${JSON.stringify(fragment)}`);
  }
}

function assertNoMatch(text, pattern, message) {
  assert(!pattern.test(text), message);
}

const rootPackage = JSON.parse(await source('package.json'));
assert(
  rootPackage.scripts['build:pi-agent-host'],
  'The current API adapter host must be buildable.',
);
assert(
  rootPackage.scripts['harness:review-fixes'].includes('check:model-catalog-freshness'),
  'The architecture guard must verify the exact model catalog.',
);
assert(
  rootPackage.scripts.validate.includes('harness:pi-agent-host') &&
    rootPackage.scripts.validate.includes('harness:runtime-conformance'),
  'Validate must cover the production API adapter and neutral runtime conformance.',
);

const desktopPackage = JSON.parse(await source('apps/desktop/package.json'));
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'Desktop release builds must bundle the current API adapter host.',
);

const tauriConfig = await source('apps/desktop/src-tauri/tauri.conf.json');
assertIncludesAll(
  tauriConfig,
  ['resources/pi-agent-host.mjs', 'resources/node/bin/node'],
  'The release bundle must include the current API adapter host and its runtime.',
);

const neutralCommands = [
  'agent_runtime_execute',
  'agent_runtime_enhance',
  'agent_runtime_collaborate',
  'agent_runtime_resume',
  'agent_runtime_abort',
  'agent_runtime_control',
  'agent_runtime_confirm_execution',
  'agent_runtime_answer',
  'agent_runtime_stream_snapshot',
  'agent_runtime_release_stream',
  'agent_runtime_reattach',
  'agent_runtime_status',
];
const agentBridgePermission = await source('apps/desktop/src-tauri/permissions/agent-bridges.toml');
assertIncludesAll(
  agentBridgePermission,
  neutralCommands.map((command) => `"${command}"`),
  'Tauri permissions must expose the complete neutral production gateway.',
);
assert(
  agentBridgePermission.includes('"pi_agent_status"'),
  'The implementation diagnostic status command must remain explicitly scoped.',
);
assertNoMatch(
  agentBridgePermission,
  /pi_agent_(save_provider|open_config_folder)|runtime_provider_|llm_fetch/u,
  'Tauri permissions must not expose a second provider configuration or raw transport path.',
);

const rustLib = await source('apps/desktop/src-tauri/src/lib.rs');
assertIncludesAll(
  rustLib,
  neutralCommands.map((command) => `pi_agent_host::${command}`),
  'The Rust command registry must mount the complete neutral production gateway.',
);
assertNoMatch(
  rustLib,
  /pi_agent_(save_provider|open_config_folder)|runtime_provider_|llm_fetch/u,
  'The Rust registry must not retain a writable implementation-config lane.',
);

const workspaceBindingHost = await source('apps/desktop/src-tauri/src/task_workspace_binding.rs');
assertIncludesAll(
  workspaceBindingHost,
  [
    'const AGENT_RUNTIME_CONTEXT_ID: &str = "agent-runtime";',
    'context_string_matches(context_object, "runtime", AGENT_RUNTIME_CONTEXT_ID)',
  ],
  'Native Conversation continuation and interrupted-run resume must accept the neutral durable runtime identity.',
);
assert(
  workspaceBindingHost.match(
    /context_string_matches\(context_object, "runtime", AGENT_RUNTIME_CONTEXT_ID\)/gu,
  )?.length === 2,
  'Both native Conversation prestart paths must share the neutral runtime identity guard.',
);

const desktopRuntime = await source('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
assertIncludesAll(
  desktopRuntime,
  [
    'class DesktopAgentRuntimeGateway',
    'interface RuntimeEngineAdapter',
    'new DesktopAgentRuntimeGateway',
    "invokeCommand('agent_runtime_status'",
    'assertDurableExecutionTarget',
    'assertTaskExecutionAccount',
    'runtimeModelRef: resolvedModel',
    'expectedTarget: executionTarget',
  ],
  'Live chat must route through one account-scoped engine gateway with exact target evidence.',
);
assertNoMatch(
  desktopRuntime,
  /readPiModelOverride|offisim:pi-agent:model-override|runtime_provider_|llm_fetch/u,
  'Live chat must not have an adapter-global model override or legacy provider fallback.',
);

const employeePersona = await source('apps/desktop/renderer/src/data/employee-persona.ts');
assertIncludesAll(
  employeePersona,
  ["invokeCommand('agent_runtime_status'", 'availableModel.runtimeModelRef?.trim()'],
  'Employee model bindings must resolve against the safe account catalog exact reference.',
);
assertNoMatch(
  employeePersona,
  /pi_agent_status|piModelValue/u,
  'Production delegation must not consume implementation diagnostics or rebuild old provider/model ids.',
);

const settingsSurface = await source(
  'apps/desktop/renderer/src/surfaces/settings/SettingsSurface.tsx',
);
const accountsPane = await source('apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
assertIncludesAll(
  settingsSurface,
  ['AiAccountsPane', "label: 'AI Accounts'", 'RuntimePane', 'ComputerSetupPanel'],
  'Settings must lead with the neutral account information architecture.',
);
assertIncludesAll(
  accountsPane,
  ["invokeCommand('agent_runtime_status'", 'Models', 'Usage', 'Cost'],
  'AI Accounts must use the safe status projection and truthful Usage/Cost sections.',
);
assertNoMatch(
  settingsSurface + accountsPane,
  /PiAgentPane|pi_agent_status|pi_agent_open_config_folder|pi_agent_save_provider|auth\.json|models\.json|Provider profile/u,
  'Ordinary Settings must not expose implementation identity, auth files, or provider-profile editing.',
);

const hostSource = await source('scripts/tauri-pi-agent-host.entry.mjs');
assertIncludesAll(
  hostSource,
  ['runtimeStatusProjection', 'createRequestExecutionTargetGate', 'resolveApiRunUsage'],
  'The current API adapter must project a safe catalog, gate exact targets, and report honest usage.',
);
assertNoMatch(
  hostSource,
  /saveProvider|piSaveProvider|writeModelsJsonProvider|providerTemplates:/u,
  'The host must not retain the old writable provider-profile mode.',
);

for (const removedPath of [
  'apps/desktop/renderer/src/surfaces/settings/PiAgentPane.tsx',
  'apps/desktop/renderer/src/surfaces/settings/ProviderPane.tsx',
  'apps/desktop/renderer/src/runtime/pi-agent-config.ts',
  'apps/desktop/renderer/src/lib/provider-bridge.ts',
  'apps/desktop/renderer/src/lib/tauri-llm-fetch.ts',
  'apps/desktop/renderer/src/lib/llm-transport-protocol.ts',
]) {
  assert(!(await exists(removedPath)), `${removedPath} must stay removed from the product path.`);
}

console.log('harness-review-fixes: engine gateway and API account guards passed');
