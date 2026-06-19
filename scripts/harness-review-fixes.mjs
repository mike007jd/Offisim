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
  if (!condition) {
    throw new Error(message);
  }
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
assert(rootPackage.scripts['build:pi-agent-host'], 'root scripts must build the Pi Agent host.');
assert(
  !rootPackage.scripts['provider:check'],
  'provider:check must not exist after Pi-only cutover.',
);
assert(
  rootPackage.scripts.validate.includes('harness:pi-agent-host'),
  'validate must include the Pi Agent host harness.',
);
assert(
  !rootPackage.scripts.validate.includes('provider:check'),
  'validate must not include the old provider catalog freshness gate.',
);

const desktopPackage = JSON.parse(await source('apps/desktop/package.json'));
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host.',
);
assertNoMatch(
  desktopPackage.scripts['build:frontend'],
  /claude|codex|provider:check/u,
  'desktop build must not invoke old Claude/Codex/provider lanes.',
);

const tauriConfig = await source('apps/desktop/src-tauri/tauri.conf.json');
assertIncludesAll(
  tauriConfig,
  ['resources/pi-agent-host.mjs', 'resources/node/bin/node'],
  'release bundle must include the Pi Agent host and bundled Node runtime.',
);
assertNoMatch(
  tauriConfig,
  /claude-agent-host|codex-agent-host|provider-source-registry/u,
  'release bundle must not include old sidecar or catalog resources.',
);

const agentBridgePermission = await source('apps/desktop/src-tauri/permissions/agent-bridges.toml');
assertIncludesAll(
  agentBridgePermission,
  ['"pi_agent_execute"', '"pi_agent_abort"', '"pi_agent_status"'],
  'Tauri permissions must expose the Pi Agent host commands.',
);
assertNoMatch(
  agentBridgePermission,
  /runtime_secret_|runtime_provider_|claude_agent_|codex_agent_|llm_fetch/u,
  'Tauri permissions must not expose old provider, sidecar, or raw LLM transport commands.',
);

const rustLib = await source('apps/desktop/src-tauri/src/lib.rs');
assertIncludesAll(
  rustLib,
  ['mod pi_agent_host;', 'pi_agent_execute', 'pi_agent_abort', 'pi_agent_status'],
  'Rust command registry must mount only the Pi Agent host for AI execution.',
);
assertNoMatch(
  rustLib,
  /mod (claude_agent_host|codex_agent_host|llm_transport|runtime_secrets)|claude_agent_|codex_agent_|llm_fetch|runtime_provider_/u,
  'Rust command registry must not retain old AI lane modules or commands.',
);

const desktopRuntime = await source('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
assertIncludesAll(
  desktopRuntime,
  ["invoke('pi_agent_execute'", "invoke('pi_agent_abort'", "nodeName: 'pi_agent'"],
  'DesktopAgentRuntime must be a thin Pi Agent host client.',
);
assertNoMatch(
  desktopRuntime,
  /PiOrchestrationService|createGateway|ModelResolver|provider-bridge|tauri-llm-fetch|llm_fetch|claude_agent_|codex_agent_/u,
  'DesktopAgentRuntime must not rebuild the old provider/model/sidecar path.',
);

const chatRuntime = await source(
  'apps/desktop/renderer/src/assistant/runtime/desktop-chat-runtime.ts',
);
assertIncludesAll(
  chatRuntime,
  ['(payload.chatThreadId || event.threadId) !== threadId', 'Pi Agent run failed.'],
  'assistant-ui projection must consume the thread-scoped agent stream directly.',
);
assertNoMatch(
  chatRuntime,
  /STREAM_REPLY_NODES|graph_reply|assistant_response|provider call/u,
  'assistant-ui projection must not guess graph-era stream nodes.',
);
// The reply stream must stay agent-agnostic: isolation is by thread, never by a
// hard-coded backend id. A `nodeName === / !== 'pi_agent'` guard would silently
// drop a second backend's tokens (the GUI is a fixed interface many agents plug
// into), so forbid the filter from creeping back in.
assertNoMatch(
  chatRuntime,
  /nodeName\s*[!=]==\s*['"]pi_agent['"]/u,
  'reply stream must not filter on a backend id — keep it agent-agnostic.',
);

const settingsSurface = await source(
  'apps/desktop/renderer/src/surfaces/settings/SettingsSurface.tsx',
);
const settingsData = await source('apps/desktop/renderer/src/surfaces/settings/settings-data.ts');
const piAgentPane = await source('apps/desktop/renderer/src/surfaces/settings/PiAgentPane.tsx');
assertIncludesAll(
  settingsSurface,
  ['PiAgentPane', 'Pi Agent', 'disposeDesktopAgentRuntime(companyId)'],
  'Settings must present Pi Agent runtime settings.',
);
assertIncludesAll(
  settingsData,
  [
    "value: 'pi-agent'",
    "label: 'Pi Agent'",
    "defaultRuntime: 'pi-agent'",
    "runtimeBinding: 'pi-agent'",
  ],
  'Settings runtime defaults must collapse to Pi Agent.',
);
assertIncludesAll(
  piAgentPane,
  [
    'pi_agent_status',
    'pi_agent_open_config_folder',
    'Pi Agent Runtime',
    'Pi AuthStorage / ModelRegistry',
    'Pi model configuration',
    'models.json',
    'Advanced model override',
  ],
  'Pi Agent settings page must read Pi SDK-owned auth/model status.',
);
const piAgentConfig = await source('apps/desktop/renderer/src/runtime/pi-agent-config.ts');
assertIncludesAll(
  desktopRuntime + piAgentConfig,
  ['offisim:pi-agent:model-override', 'input.model?.trim() || readPiModelOverride() || undefined'],
  'Desktop runtime must pass the Pi-owned advanced model override to the Pi host.',
);
assertNoMatch(
  settingsSurface + settingsData + piAgentPane,
  /ProviderPane|runtime_provider_|provider:check|model suggestions|Type any model id|claude-agent-sdk|codex-agent-sdk|openai-agents-sdk/u,
  'Settings must not expose the old provider catalog or SDK lane mental model.',
);

for (const removedPath of [
  'apps/desktop/renderer/src/surfaces/settings/ProviderPane.tsx',
  'apps/desktop/renderer/src/lib/provider-bridge.ts',
  'apps/desktop/renderer/src/lib/tauri-llm-fetch.ts',
  'apps/desktop/renderer/src/lib/llm-transport-protocol.ts',
  'apps/desktop/src-tauri/src/claude_agent_host.rs',
  'apps/desktop/src-tauri/src/codex_agent_host.rs',
  'apps/desktop/src-tauri/src/llm_transport.rs',
  'apps/desktop/src-tauri/src/runtime_secrets.rs',
  'scripts/tauri-claude-agent-host.mjs',
  'scripts/tauri-claude-agent-host.entry.mjs',
  'scripts/tauri-codex-agent-host.entry.mjs',
  'scripts/tauri-codex-agent-host.mjs',
  'catalog/provider-source-registry/official-fixtures.json',
  'scripts/provider-source-registry/check-freshness.mjs',
]) {
  assert(!(await exists(removedPath)), `${removedPath} must stay removed in Pi-only runtime.`);
}

console.log('harness-review-fixes: Pi-only runtime guards passed');
