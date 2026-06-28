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
  [
    "return this.runPiTurn(input, 'agent_runtime_execute')",
    "'agent_runtime_execute' | 'agent_runtime_resume'",
    'await invoke(commandName',
    "invoke('agent_runtime_abort'",
    "nodeName: 'pi_agent'",
  ],
  'DesktopAgentRuntime must be a thin runtime-gateway host client (generic agent_runtime_* commands, RD-002/003/004).',
);
assertNoMatch(
  desktopRuntime,
  /PiOrchestrationService|createGateway|ModelResolver|provider-bridge|tauri-llm-fetch|llm_fetch|claude_agent_|codex_agent_/u,
  'DesktopAgentRuntime must not rebuild the old provider/model/sidecar path.',
);
assertIncludesAll(
  desktopRuntime,
  ['answerUiRequest(answer: AgentUiAnswer): Promise<void>', "await invoke('agent_runtime_answer'"],
  'Agent UI answers must be awaited and failures surfaced to the approval bar.',
);
const answerUiRequestStart = desktopRuntime.indexOf('async answerUiRequest');
const answerUiRequestEnd = desktopRuntime.indexOf('\n  async dispose', answerUiRequestStart);
assert(
  answerUiRequestStart >= 0 && answerUiRequestEnd > answerUiRequestStart,
  'DesktopAgentRuntime must expose a class-level async answerUiRequest method.',
);
const answerUiRequestMethod = desktopRuntime.slice(answerUiRequestStart, answerUiRequestEnd);
assertNoMatch(
  answerUiRequestMethod,
  /void invoke\('pi_agent_ui_response'/u,
  'answerUiRequest must not fire-and-forget Pi UI responses.',
);
assertNoMatch(
  answerUiRequestMethod,
  /\.catch\(/u,
  'answerUiRequest must not swallow Pi UI response failures.',
);

const permissionBar = await source(
  'apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
);
assertIncludesAll(
  permissionBar,
  [
    'conversationRunController.answerApproval',
    'conversationRunController.dismissApproval',
    'setDecisionError',
    'Could not deliver approval. Retry or stop the run.',
  ],
  'Approval bar must route decisions through the ConversationRunController and keep failed responses visible.',
);
assertNoMatch(
  permissionBar,
  /getDesktopAgentRuntime|runtime\.answerUiRequest|clearPendingUiRequest/u,
  'Approval bar must not bypass the ConversationRunController.',
);

const chatRuntime = await source(
  'apps/desktop/renderer/src/assistant/runtime/desktop-chat-runtime.ts',
);
assertIncludesAll(
  chatRuntime,
  ['Pi Agent run failed.', 'materializeChatTurn', 'displayAttachmentsFromStaged'],
  'desktop chat helper must keep only shared message/attachment helpers.',
);
assertNoMatch(
  chatRuntime,
  /subscribeReplyStream|subscribeRunActivity|subscribeToolCalls|subscribeAgentUiRequests|runtimeEventBus|getDesktopAgentRuntime/u,
  'stream/tool/UI subscriptions must live in ConversationRunController, not shared chat helpers.',
);

const conversationController = await source(
  'apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
);
assertIncludesAll(
  conversationController,
  [
    'runId: run.attemptId',
    "eventBus.on('llm.stream.chunk'",
    "eventBus.on('tool.execution.telemetry'",
    'AGENT_UI_REQUEST_EVENT',
  ],
  'ConversationRunController must own runId-scoped stream, tool, and UI request projection.',
);

// The old Connect chat (WorkspaceAssistantThread) was removed in the Connect/
// Loops refactor — Connect chat is now MessengerApp over the collaboration
// aggregate and deliberately does NOT use ConversationRunController (it runs the
// isolated PR-03 collaboration turn controller; guarded by harness-connect-chat-
// flow + harness-pi-collaboration-runtime). Office's runtime is the lone owner.
for (const uiOwner of ['apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts']) {
  const text = await source(uiOwner);
  assertIncludesAll(
    text,
    ['conversationRunController.submit', 'useConversationRun'],
    `${uiOwner} must submit through and read from ConversationRunController.`,
  );
  assertNoMatch(
    text,
    /getDesktopAgentRuntime|runtimeEventBus|subscribeReplyStream|subscribeRunActivity|subscribeToolCalls|subscribeAgentUiRequests|persistChatMessage/u,
    `${uiOwner} must not own Pi runtime, runtime bus subscriptions, or direct chat persistence.`,
  );
}

const settingsSurface = await source(
  'apps/desktop/renderer/src/surfaces/settings/SettingsSurface.tsx',
);
const settingsData = await source('apps/desktop/renderer/src/surfaces/settings/settings-data.ts');
const runtimePane = await source('apps/desktop/renderer/src/surfaces/settings/RuntimePane.tsx');
const piAgentPane = await source('apps/desktop/renderer/src/surfaces/settings/PiAgentPane.tsx');
assertIncludesAll(
  settingsSurface,
  ['PiAgentPane', 'RuntimePane', 'Pi Agent'],
  'Settings must present the Pi Agent and Runtime panes.',
);
assertNoMatch(
  settingsSurface,
  /disposeDesktopAgentRuntime/u,
  'Saving Settings must not dispose the Pi runtime: runtime settings no longer feed Pi, so a save has nothing to reload.',
);
assertNoMatch(
  settingsData,
  /runtimeFormSchema|executionMode|summarizationTrigger|memoryMaxFacts|runtimeBinding/u,
  'Settings must not keep a runtime form of fake controls that never reach the Pi request.',
);
assertIncludesAll(
  runtimePane,
  ['Resolved: ', 'Pi Agent', 'per conversation'],
  'Runtime pane must state runtime knobs are chosen per conversation and resolve to Pi Agent.',
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
