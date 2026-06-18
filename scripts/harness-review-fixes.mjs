#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

async function source(path) {
  return readFile(resolve(ROOT, path), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertMatch(text, pattern, message) {
  assert(pattern.test(text), message);
}

function assertNoMatch(text, pattern, message) {
  assert(!pattern.test(text), message);
}

function assertIncludesAll(text, fragments, message) {
  for (const fragment of fragments) {
    assert(text.includes(fragment), `${message} Missing fragment: ${JSON.stringify(fragment)}`);
  }
}

const queries = await source('apps/desktop/renderer/src/data/queries.ts');
const uiState = await source('apps/desktop/renderer/src/app/ui-state.ts');
assertNoMatch(
  uiState,
  /setCompany:/u,
  'ui state must not expose a company-only setter that leaves project/thread scope stale.',
);
assertMatch(
  uiState,
  /closeThread: \(\) => set\(\{ selectedThreadId: null, railMode: 'list' \}\)/u,
  'closeThread must clear selectedThreadId so closed conversations are not still marked active.',
);
assertMatch(
  queries,
  /localDbTransaction\([\s\S]*?\);\s*try\s*\{\s*await deleteCompanyWorkspace\(companyId\);/u,
  'deleteCompanyDeep must commit DB deletion before best-effort workspace cleanup.',
);
assertMatch(
  queries,
  /catch \(error\) \{\s*return \{\s*persisted: true,\s*workspaceCleanupError:/u,
  'deleteCompanyDeep must keep DB deletion successful when workspace cleanup fails.',
);
assertNoMatch(
  queries,
  /DELETE FROM settings WHERE key LIKE|DELETE FROM settings[\s\S]*?value LIKE/u,
  'deleteCompanyDeep must not fuzzy-delete global settings by company id.',
);
for (const hookName of ['useRenameThread', 'useArchiveThread', 'useDeleteConversation']) {
  assertMatch(
    queries,
    new RegExp(
      `export function ${hookName}[\\s\\S]*?repos\\.chatThreads\\.findById\\(threadId\\);[\\s\\S]*?missing: true`,
      'u',
    ),
    `${hookName} must fail closed for nonexistent chat_threads rows.`,
  );
}
assertMatch(
  queries,
  /deleteConversationDeep[\s\S]*?DELETE FROM file_history WHERE thread_id = \$1[\s\S]*?DELETE FROM graph_threads WHERE thread_id = \$1/u,
  'conversation hard-delete must clear thread-scoped file_history before deleting graph_threads.',
);
assertIncludesAll(
  queries,
  [
    "invoke<StoredAttachmentMeta[]>('attachment_list', { companyId, threadId })",
    "invoke<StoredAttachmentMeta[]>('attachment_list_all')",
    "invoke('attachment_delete', { vaultRef: attachmentVaultRef(meta) })",
    'await deleteThreadAttachments(threadId, companyId)',
  ],
  'conversation hard-delete must delete thread-scoped attachment blobs before event rows make vaultRefs unreachable.',
);

const chatRail = await source('apps/desktop/renderer/src/surfaces/office/ChatRail.tsx');
assertMatch(
  chatRail,
  /<ConversationActionsMenu\s+thread=\{activeThread\}/u,
  'workspace synthetic conversations must not receive persisted thread actions.',
);

const companySelection = await source(
  'apps/desktop/renderer/src/surfaces/lifecycle/CompanySelectionPage.tsx',
);
assertMatch(
  companySelection,
  /await activateCompanyScope\(\{[\s\S]*?companyId: company\.id,[\s\S]*?setScope,[\s\S]*?surface: 'office'/u,
  'enterCompany must activate company/project scope through the shared provisioning helper.',
);
assertMatch(
  companySelection,
  /else if \(result\.missing\) \{[\s\S]*?toast\.error\('Company no longer exists\.'\)/u,
  'company mutations must surface stale/missing company rows instead of success.',
);

const activateCompanyScope = await source(
  'apps/desktop/renderer/src/runtime/activate-company-scope.ts',
);
assertMatch(
  activateCompanyScope,
  /projectId = await resolveCompanyScopeProjectId\(repos, companyId\)/u,
  'activateCompanyScope must route project binding through the shared fail-closed helper.',
);
assertMatch(
  activateCompanyScope,
  /shouldCommit && !shouldCommit\(\)[\s\S]*?return;[\s\S]*?setScope\(companyId, projectId\)/u,
  'activateCompanyScope must support latest-wins callers before writing scope.',
);
assertNoMatch(
  activateCompanyScope,
  /repos\.companies\.findById\(companyId\)/u,
  'activateCompanyScope must not duplicate the shared company existence lookup.',
);

const commandPalette = await source('apps/desktop/renderer/src/app/CommandPalette.tsx');
assertMatch(
  commandPalette,
  /let commandCompanyActivationSeq = 0;[\s\S]*?const seq = \+\+commandCompanyActivationSeq;[\s\S]*?shouldCommit: \(\) => seq === commandCompanyActivationSeq/u,
  'command palette company switching must be latest-wins across async activation.',
);

const providerBridge = await source('apps/desktop/renderer/src/lib/provider-bridge.ts');
assertMatch(
  providerBridge,
  /credentialMode: 'local-auth'/u,
  'Claude Code local account test must call the host bridge in local-auth mode.',
);
assertMatch(
  providerBridge,
  /if \(isClaudeLocalAuthProfile\(profile\)\) \{[\s\S]*?return sendClaudeAgentTextDetailed/u,
  'local-auth profiles must bypass stored provider-secret checks.',
);
assertMatch(
  providerBridge,
  /const parsed = parseProviderResponse\(raw\);[\s\S]*?text: extractProviderTextFromParsed\(parsed\)[\s\S]*?usage: extractProviderUsageFromParsed\(parsed\)/u,
  'provider responses must be parsed once for text and usage extraction.',
);
assertIncludesAll(
  providerBridge,
  [
    'baseUrl?: string',
    'new URL(candidate.baseUrl).hostname.toLowerCase()',
    "host === 'openrouter.ai'",
    "host.endsWith('.openrouter.ai')",
  ],
  'default chat provider selection must exclude OpenRouter by endpoint host, not only by provider name.',
);

const settingsSurface = await source(
  'apps/desktop/renderer/src/surfaces/settings/SettingsSurface.tsx',
);
const providerPane = await source('apps/desktop/renderer/src/surfaces/settings/ProviderPane.tsx');
const settingsData = await source('apps/desktop/renderer/src/surfaces/settings/settings-data.ts');
assertMatch(
  settingsSurface,
  /runtime_provider_profile_save/u,
  'provider save must use the atomic profile+secret desktop command.',
);
assertMatch(
  settingsData,
  /credentialDestination: 'http:\/\/localhost:11434\/v1'/u,
  'Ollama OpenAI-compatible base URL must include /v1 before transport appends chat/completions.',
);
assertIncludesAll(
  providerPane,
  [
    "if (config.providerProtocol === 'anthropic') return 'anthropic-compat'",
    "if (config.providerProtocol === 'openai-compat') return 'openai-compat'",
    "if (config.providerProtocol === 'openai') return 'openai'",
  ],
  'Provider route summary must show the actual saved provider protocol instead of product facade labels.',
);
assertNoMatch(
  settingsData,
  /baseRuntimeProfileMatch|displayName\.toLowerCase\(\)\.includes\(/u,
  'runtime provider config merge must not fuzzy-match profiles by display name.',
);
assertNoMatch(
  settingsData,
  /api\.openai\.com|api\.anthropic\.com/u,
  'OpenAI/Anthropic facade configs must not persist native provider endpoints.',
);
assertIncludesAll(
  settingsData,
  [
    'function providerProtocolForRuntimeProfile(profile: RuntimeProviderProfile): ProviderProtocol',
    "if (profile.provider === 'anthropic') return 'anthropic'",
    'providerProtocol: providerProtocolForRuntimeProfile(profile)',
  ],
  'runtime provider configs must preserve anthropic-compatible provider protocol when merged into Settings.',
);
assertIncludesAll(
  settingsData,
  [
    "id: 'openai-backup'",
    "credentialDestination: 'https://api.z.ai/api/paas/v4'",
    "secretRef: 'zai'",
    "providerProtocol: 'openai-compat'",
    "id: 'anthropic'",
    "credentialDestination: 'https://api.minimax.io/anthropic'",
    "secretRef: 'minimax'",
    "providerProtocol: 'anthropic'",
  ],
  'OpenAI/Anthropic facade configs must route through z.ai/MiniMax compatible endpoints.',
);
assertNoMatch(
  settingsData,
  /getTauriDb\(\)/u,
  'Settings external employees must use the employee repository instead of direct SQL.',
);
assertMatch(
  settingsData,
  /repos\.employees\.findByCompany\(companyId\)[\s\S]*?row\.is_external === 1/u,
  'Settings external employees must filter real repo rows by is_external.',
);
assertMatch(
  providerPane,
  /\$\{endpointBase\}\/chat\/completions/u,
  'provider endpoint preview must append chat/completions to the configured base URL.',
);
assertNoMatch(
  providerPane,
  /\/v1\/chat\/completions/u,
  'provider endpoint preview must not hardcode a second /v1 segment.',
);
assertMatch(
  providerPane,
  /const profile = profiles\.find\(\(candidate\) => candidate\.id === active\.id\)/u,
  'provider test must use the exact selected runtime profile id.',
);
assertNoMatch(
  providerPane,
  /runtimeProfileMatches/u,
  'provider test must not fall back to fuzzy provider/name matching.',
);
const agentBridgePermission = await source('apps/desktop/src-tauri/permissions/agent-bridges.toml');
assertMatch(
  agentBridgePermission,
  /"runtime_provider_profile_save"/u,
  'provider profile save command must be allowed by the Tauri agent-bridges permission.',
);
const aclManifest = await source('apps/desktop/src-tauri/gen/schemas/acl-manifests.json');
assertMatch(
  aclManifest,
  /"runtime_provider_profile_save"/u,
  'generated Tauri ACL manifest must include runtime_provider_profile_save.',
);
assertMatch(
  settingsSurface,
  /disposeDesktopAgentRuntime\(companyId\)/u,
  'provider save must evict the cached company runtime.',
);
assertIncludesAll(
  settingsSurface,
  [
    'blockedNativeProviderEndpoint',
    "host === 'api.openai.com'",
    "host === 'api.anthropic.com'",
    'throw new Error(blockedEndpoint)',
  ],
  'provider save must reject native OpenAI/Anthropic endpoints even via override.',
);
assertNoMatch(
  settingsSurface,
  /return 'openai';/u,
  'Settings provider save must not persist the native OpenAI protocol.',
);

assertMatch(
  queries,
  /repos\.companies\.findById\(companyId\);[\s\S]*?missing: true/u,
  'company update/delete mutations must fail closed for stale company rows.',
);
assertMatch(
  queries,
  /loadProjectChatThreadRows[\s\S]*?repos\.chatThreads\.listByProject[\s\S]*?run_status[\s\S]*?select: \(rows\) => rows\.map\(threadToVm\)/u,
  'Office and Workspace conversation lists must load raw chat-thread rows once and derive VM rows through query select.',
);

const runtimeSecrets = await source('apps/desktop/src-tauri/src/runtime_secrets.rs');
const officialProviderFixtures = await source(
  'catalog/provider-source-registry/official-fixtures.json',
);
const curatedProviderCatalog = await source(
  'catalog/provider-source-registry/generated/curated-catalog.json',
);
for (const [label, providerCatalogSource] of [
  ['official provider fixtures', officialProviderFixtures],
  ['curated provider catalog', curatedProviderCatalog],
]) {
  assertNoMatch(
    providerCatalogSource,
    /claude-(?:opus|sonnet)-4-20250514/u,
    `${label} must not expose retired Claude 20250514 model ids.`,
  );
}
assertMatch(
  runtimeSecrets,
  /pub fn runtime_provider_profile_save[\s\S]*?profile_from_upsert_request\(&req\)\?[\s\S]*?write_secret_file\(&path, secret\)\?/u,
  'provider profile save must validate profile before writing the secret.',
);
assertIncludesAll(
  runtimeSecrets,
  [
    'reject_native_provider_endpoint(&profile)?',
    'skipped invalid provider profile',
    'profile.allowed_host == "api.openai.com"',
    'profile.allowed_host == "api.anthropic.com"',
    'let mut secret_rollback',
    'let previous_secret = read_secret_file(&path)?;',
    'restore_secret_file(&path, previous_secret)',
    'if let Err(err) = append_provider_profile_audit(&profile, action)',
  ],
  'provider profile save must reject native endpoints, roll back newly written secrets, and treat post-commit audit as best-effort.',
);
assertNoMatch(
  runtimeSecrets,
  /return "x-api-key"\.into\(\)/u,
  'runtime provider profiles must not retain native Anthropic x-api-key routing.',
);
assertNoMatch(
  runtimeSecrets,
  /profile\.provider == "(?:openai|anthropic)" && profile\.allowed_host/u,
  'runtime provider native endpoint rejection must apply by host even when a profile is marked openai-compat.',
);
assertIncludesAll(
  runtimeSecrets,
  ['id: "claude-code-local".into()', 'base_url: "http://localhost".into()', 'local_endpoint: true'],
  'Claude Code local-auth profile must be represented as host-resolved local auth, not a native Anthropic endpoint.',
);
assertMatch(
  runtimeSecrets,
  /id: "claude-code-local"\.into\(\)[\s\S]*?execution_lane: "claude-agent-sdk"\.into\(\)[\s\S]*?auth_mode: "local-auth"\.into\(\)/u,
  'runtime profiles must expose a claude-code-local local-auth profile.',
);
assertMatch(
  runtimeSecrets,
  /id: "claude-code-local"\.into\(\)[\s\S]*?model: String::new\(\)/u,
  'Claude Code local-auth profile must not force an old fixed model id; it is account-managed unless Advanced overrides it.',
);
assertMatch(
  runtimeSecrets,
  /profile\.has_credential = if profile\.auth_mode == "local-auth" \{[\s\S]*?false/u,
  'local-auth runtime profiles must not require a stored provider secret.',
);
assertNoMatch(
  runtimeSecrets,
  /read_keyed_secret\(secret_ref\)\?\.map_or_else\(read_secret_raw/u,
  'provider-profile secrets must not fall back to the legacy global runtime secret.',
);

const claudeHost = await source('apps/desktop/src-tauri/src/claude_agent_host.rs');
assertMatch(
  claudeHost,
  /credential_mode == ClaudeCredentialMode::LocalAuth[\s\S]*?assert_local_auth_profile/u,
  'Claude host local-auth requests must be restricted to local-auth runtime profiles.',
);
assertMatch(
  claudeHost,
  /"credentialMode": match credential_mode/u,
  'Claude host must pass credentialMode through to the sidecar payload.',
);

const sidecar = await source('scripts/tauri-claude-agent-host.entry.mjs');
assertMatch(
  sidecar,
  /const apiKey = credentialMode === 'local-auth' \? undefined : injectedApiKey\(\);/u,
  'release sidecar must not inject ANTHROPIC credentials in local-auth mode.',
);
assertIncludesAll(
  sidecar,
  [
    'function assertLlmRequest(request)',
    '!Array.isArray(request.messages)',
    'Trusted host request must include a messages array.',
    'Trusted host request messages must include string role and content fields.',
    'assertLlmRequest(payload.request)',
  ],
  'release sidecar must reject malformed request payloads before the SDK adapter throws internal shape errors.',
);

assertMatch(
  providerBridge,
  /\.\.\.\(profile\.model\.trim\(\) \? \{ model: profile\.model\.trim\(\) \} : \{\}\)/u,
  'Claude local-auth test requests must omit model when the profile is account-managed.',
);
const claudeAgentSdkAdapter = await source('packages/core/src/llm/claude-agent-sdk-adapter.ts');
assertMatch(
  claudeAgentSdkAdapter,
  /model: request\.model\?\.trim\(\) \? request\.model\.trim\(\) : undefined/u,
  'Claude Agent SDK adapter must let account-managed local auth omit model.',
);

assertIncludesAll(
  providerPane,
  ['Pi Agent Runtime', 'Model override', 'Account default', 'Runtime profiles'],
  'Provider settings must present Pi Agent runtime/account configuration, not a primary model catalog.',
);
assertNoMatch(
  providerPane,
  /Model suggestions|model suggestions|Type any model id|This model reasons before answering|Runtime profile models/u,
  'Provider settings main path must not expose old model-catalog suggestions or model warnings.',
);

const desktopRuntime = await source('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
assertIncludesAll(
  desktopRuntime,
  [
    'async resume(threadId: string, projectId?: string | null): Promise<PiExecuteResult | null>',
    'this.repos.threads.findById(threadId)',
    'this.repos.chatThreads.findById(threadId)',
    'validCompanyProjectId(this.repos, this.companyId, projectId)',
    'validCompanyProjectId(this.repos, this.companyId, thread?.project_id)',
    'validCompanyProjectId(this.repos, this.companyId, chatThread?.project_id)',
    'ensureProjectBoundForRun(',
    'requestedProjectId',
    'projectId: resolvedProjectId',
    "['queued', 'running', 'paused'].includes(thread.status)",
    'classifyNoopResume(this.repos, threadId)',
    "if (last?.role !== 'assistant') return 'blocked'",
    "if (errorMessage) return 'blocked'",
    "if (stopReason && stopReason !== 'stop') return 'blocked'",
    "this.repos.threads.updateStatus(threadId, 'blocked')",
    "throw new Error('Cannot resume: this run has no resumable transcript.')",
    "this.repos.threads.updateStatus(threadId, 'completed')",
    'return result',
  ],
  'desktop resume must restore a bound project and block empty-transcript resume instead of marking it completed.',
);
assertMatch(
  desktopRuntime,
  /conversationKey: `\$\{resolvedProjectId \?\? ''\}::\$\{threadId\}::`/u,
  'desktop resume runScope must carry the resolved project id.',
);
assertIncludesAll(
  desktopRuntime,
  ['resolveProjectRoot: async (projectId)', 'project?.company_id !== companyId', 'return null'],
  'desktop shell project-root resolution must reject cross-company projects.',
);

const ensureDefaultWorkspace = await source(
  'apps/desktop/renderer/src/runtime/ensure-default-workspace.ts',
);
assertIncludesAll(
  ensureDefaultWorkspace,
  ['repos.companies.findById(companyId)', 'throw new Error(`Company ${companyId} not found.`)'],
  'default workspace provisioning must fail closed when the company no longer exists.',
);
assertIncludesAll(
  ensureDefaultWorkspace,
  [
    'project.company_id !== companyId',
    'throw new Error(`Project ${requestedProjectId} does not belong to company ${companyId}.`)',
  ],
  'project binding must reject project ids from another company.',
);

const piOrchestration = await source('packages/core/src/pi-bridge/pi-orchestration-service.ts');
const personnelSurface = await source(
  'apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx',
);
assertIncludesAll(
  personnelSurface,
  [
    'const row = await repos.employees.findById(employee.id)',
    "toast.error('Employee no longer exists')",
    'await repos.employees.delete(employee.id)',
  ],
  'personnel employee delete must not report success for stale employee rows.',
);
assertIncludesAll(
  piOrchestration,
  [
    'if (existing) {',
    "updateStatus(params.threadId, 'running')",
    'existing.project_id',
    'updateProject(params.threadId, nextProjectId)',
  ],
  'pi must backfill graph_threads.project_id when an existing thread resumes or runs with a project.',
);
assertIncludesAll(
  piOrchestration,
  [
    'return this.withThreadLock(input.threadId, async () => {',
    'const transcript = await store.loadTranscript(input.threadId)',
  ],
  'pi resume must reload transcript inside the per-thread lock.',
);
assertMatch(
  piOrchestration,
  /employee && employee\.company_id !== input\.companyId/u,
  'pi direct execution must reject employees from another company.',
);
assertMatch(
  piOrchestration,
  /existing\.company_id !== params\.companyId/u,
  'pi must reject existing threads from another company before status/project updates.',
);
assertMatch(
  await source('packages/core/src/pi-bridge/pi-tool-adapter.ts'),
  /executionMode: readOnly \? 'parallel' : 'sequential'/u,
  'pi agent should honor tool executionMode instead of forcing every batch sequential.',
);

const delegateTool = await source('packages/core/src/pi-bridge/pi-delegate-tool.ts');
assertMatch(
  delegateTool,
  /employee\.company_id !== deps\.toolCtx\.companyId/u,
  'delegate must reject employee ids outside the active company.',
);

const piMessageStore = await source('packages/core/src/pi-bridge/pi-message-store.ts');
assertIncludesAll(
  piMessageStore,
  [
    'this.repo.maxSeq(threadId)',
    'cachedStart === undefined',
    'retryStart = (await this.repo.maxSeq(threadId)) + 1',
    'rememberNextSeq',
  ],
  'pi message persistence must avoid maxSeq on every append while retrying after stale seq cache conflicts.',
);
assertIncludesAll(
  piMessageStore,
  ['MAX_SEQ_CACHE_THREADS', 'while (this.nextSeqByThread.size > MAX_SEQ_CACHE_THREADS)'],
  'pi message seq cache must not grow without bound across long-lived desktop sessions.',
);

const resumeBar = await source('apps/desktop/renderer/src/assistant/parts/ResumeBar.tsx');
const dataQueries = await source('apps/desktop/renderer/src/data/queries.ts');
assertIncludesAll(
  dataQueries,
  [
    'COALESCE(gtp.project_id, ctp.project_id) AS project_id',
    'LEFT JOIN projects gtp ON gtp.project_id = gt.project_id AND gtp.company_id = gt.company_id',
    'LEFT JOIN chat_threads ct ON ct.thread_id = gt.thread_id',
    'LEFT JOIN projects ctp ON ctp.project_id = ct.project_id AND ctp.company_id = gt.company_id',
    'LEFT JOIN projects p ON p.project_id = COALESCE(gtp.project_id, ctp.project_id)',
  ],
  'unfinished-thread resume query must ignore stale graph project ids and fall back to chat_threads.project_id.',
);
assertIncludesAll(
  resumeBar,
  ['const resumeSeq = useRef(0)', 'const seq = ++resumeSeq.current', 'seq !== resumeSeq.current'],
  'ResumeBar must make async resume navigation latest-wins.',
);
assertIncludesAll(
  resumeBar,
  ['repos.companies.findById(item.companyId)', "throw new Error('Company no longer exists.')"],
  'ResumeBar must verify the company still exists before writing active scope.',
);
assertIncludesAll(
  resumeBar,
  [
    "if (item.state === 'blocked')",
    'repos.projects.findById(projectId)',
    'ensureProjectBoundForRun(repos, item.companyId, item.projectId || null)',
    "setScope(item.companyId, projectId ?? '')",
    'runtime.resume(item.threadId, projectId)',
  ],
  'ResumeBar must scope UI and runtime resume to the same resolved project.',
);
assertMatch(
  resumeBar,
  /if \(item\.state === 'blocked'\)[\s\S]*?return projectId;[\s\S]*?return ensureProjectBoundForRun/u,
  'blocked ResumeBar review navigation must not provision a default workspace before opening the thread.',
);
assertNoMatch(
  resumeBar,
  /catch[\s\S]*?return item\.projectId \|\| null/u,
  'ResumeBar must not fall back to stale project ids after project binding fails.',
);
assertMatch(
  resumeBar,
  /const result = await runtime\.resume\(item\.threadId, projectId\);[\s\S]*?if \(seq !== resumeSeq\.current\) return;[\s\S]*?dismissResume\(\);[\s\S]*?if \(!result\)/u,
  'ResumeBar must dismiss only after runtime resume resolves and must surface no-op resumes.',
);
assertMatch(
  resumeBar,
  /toast\.error\('Conversation resume failed'/u,
  'ResumeBar must surface runtime resume failure instead of silently hiding the banner.',
);

const workspaceMessageEvents = await source(
  'apps/desktop/renderer/src/surfaces/workspace/workspace-message-events.ts',
);
const workspaceAssistantThread = await source(
  'apps/desktop/renderer/src/surfaces/workspace/apps/WorkspaceAssistantThread.tsx',
);
assertIncludesAll(
  workspaceMessageEvents,
  [
    'import { loadPersistedChatMessages, persistChatMessage }',
    'persistChatMessage({',
    'loadPersistedChatMessages(threadId)',
    'workspaceDeliverable?: WsMessage',
    'workspaceDeliverable: message.deliverable',
    'const deliverable = workspaceMessage.workspaceDeliverable',
    'deliverable,',
    'WORKSPACE_CHAT_MESSAGE_EVENT',
    'mergeWorkspaceMessages(legacyMessages, canonicalMessages)',
  ],
  'workspace conversations must write the shared direct-chat transcript while preserving workspace deliverable cards.',
);
assertNoMatch(
  workspaceMessageEvents,
  /eventType: WORKSPACE_CHAT_MESSAGE_EVENT[\s\S]*?payload: \{ message/u,
  'workspace conversation sends must not keep writing a second workspace-only transcript.',
);
assertIncludesAll(
  workspaceAssistantThread,
  [
    'const queryClient = useQueryClient()',
    "queryClient.invalidateQueries({ queryKey: ['messages', active.id] })",
    "queryKey: ['ws', 'persisted-thread-messages', active.id]",
    'await persistMessage(userMessage)',
    'await persistMessage(assistantMessage)',
  ],
  'workspace chat sends must refresh both Office and Workspace transcript caches after canonical persistence.',
);

const externalEmployeesPane = await source(
  'apps/desktop/renderer/src/surfaces/settings/ExternalEmployeesPane.tsx',
);
const refreshAgentCardBody =
  externalEmployeesPane.match(
    /async function refreshAgentCard\(employee: ExternalEmployee\) \{[\s\S]*?\n {2}\}/u,
  )?.[0] ?? '';
assert(refreshAgentCardBody, 'external employee refresh function must exist.');
assertMatch(
  refreshAgentCardBody,
  /refreshAgentCard[\s\S]*?repos\.employees\.findById\(employee\.id\)[\s\S]*?External employee no longer exists[\s\S]*?discoverAgentCard\(employee\.cardUrl \|\| employee\.url\)/u,
  'external employee refresh must fail closed for stale/deleted rows before contacting the remote card URL.',
);
assertNoMatch(
  refreshAgentCardBody,
  /discoverAgentCard\(employee\.cardUrl \|\| employee\.url\)[\s\S]*?repos\.employees\.findById\(employee\.id\)/u,
  'external employee refresh must not let a broken remote card mask a stale local row.',
);

const teamDock = await source('apps/desktop/renderer/src/surfaces/office/TeamDock.tsx');
assertIncludesAll(
  teamDock,
  [
    'threads.data?.find((thread) => thread.employeeId === employee.id)',
    'queryClient.getQueryData<ProjectChatThreadRow[]>',
    'staleTime: 5_000',
  ],
  'TeamDock direct chat must use existing thread data/cache before falling back to a full thread reload.',
);

const piBudget = await source('packages/core/src/pi-bridge/pi-budget.ts');
assertIncludesAll(
  piBudget,
  [
    'deps.runtimeCtx.repos.asyncTransact',
    'const repos = txRepos ?? deps.runtimeCtx.repos',
    'repos.threads.updateCompactBaseline(threadId, rebasedBaselineJson)',
    'txPiMessages.deleteFirstByThread(threadId, dropCount)',
  ],
  'Pi compaction rebase must update compact baseline and delete persisted prefix in one awaited repository transaction when available.',
);
assertMatch(
  piBudget,
  /asyncTransact\(async \(txRepos\) =>/u,
  'Pi compaction rebase transaction callback must accept txRepos without a default parameter so Tauri asyncTransact uses the transaction backend.',
);
assertNoMatch(
  piBudget,
  /async \(txRepos =/u,
  'Pi compaction rebase must not use default parameters that make callback.length zero for Tauri asyncTransact.',
);
assertNoMatch(
  piBudget,
  /void (?:deps\.runtimeCtx\.repos\.threads\.updateCompactBaseline|piMessages\.deleteFirstByThread)/u,
  'Pi compaction rebase must not fire-and-forget async repository writes before mutating live transcript.',
);

const agentHostRuntime = await source('apps/desktop/src-tauri/src/agent_host_runtime.rs');
assertIncludesAll(
  agentHostRuntime,
  [
    'company_id: Option<&str>',
    'companyId is required',
    'WHERE project_id = ?',
    'AND company_id = ?',
  ],
  'trusted agent host workspace binding must filter project by company.',
);
assertMatch(
  agentHostRuntime,
  /pub\(crate\) fn required_text[\s\S]*?trusted \{\} lane requests/u,
  'trusted agent hosts must share required text validation across Codex and Claude lanes.',
);
assertIncludesAll(
  agentHostRuntime,
  [
    'pub(crate) fn dev_workspace_root() -> Option<PathBuf> {',
    '!cfg!(debug_assertions)',
    'return None;',
  ],
  'release trusted host sidecars must not fall back to source checkout scripts.',
);
assertNoMatch(
  agentHostRuntime,
  /not found in bundled resources[\s\S]*local workspace checkout/u,
  'release trusted host missing-resource errors must not advertise source-checkout fallback.',
);
assertIncludesAll(
  agentHostRuntime,
  [
    'const BUNDLED_NODE_RELATIVE_TO_RESOURCES: &str = "node/bin/node";',
    'fn resolve_node_executable(script_path: &Path) -> PathBuf',
    'std::env::var_os("OFFISIM_NODE_EXECUTABLE")',
    'bundled_node_executable(script_path)',
    'Command::new(&node_executable)',
  ],
  'release trusted host sidecars must use the bundled Node runtime before falling back to PATH.',
);

const tauriConf = await source('apps/desktop/src-tauri/tauri.conf.json');
assertIncludesAll(
  tauriConf,
  ['"resources/node/bin/node"'],
  'release app bundle must include a Node runtime for trusted host sidecars.',
);

const buildClaudeAgentHost = await source('scripts/build-claude-agent-host.mjs');
assertIncludesAll(
  buildClaudeAgentHost,
  ['const NODE_OUTFILE', 'process.execPath', 'copyNodeRuntime()', 'nodeRuntime'],
  'Claude host build must copy the build Node runtime into desktop resources.',
);

const codexHost = await source('apps/desktop/src-tauri/src/codex_agent_host.rs');
assertMatch(
  codexHost,
  /output_cap_bytes: Some\(16 \* 1024 \* 1024\)/u,
  'Codex trusted host must cap stdout/stderr like the Claude lane.',
);
assertIncludesAll(
  codexHost,
  [
    'required_text(',
    'req.provider_profile_id.as_ref()',
    '"providerProfileId"',
    'read_provider_secret(Some(provider_profile.secret_ref.as_str()))',
  ],
  'Codex trusted host must require a provider profile and avoid legacy global secret fallback.',
);
assertMatch(
  codexHost,
  /required_text\(req\.company_id\.as_ref\(\), "companyId"/u,
  'Codex trusted host must require companyId for project ownership checks.',
);
assertIncludesAll(
  claudeHost,
  [
    'required_text(',
    'req.provider_profile_id.as_ref()',
    '"providerProfileId"',
    'read_provider_secret(Some(provider_profile.secret_ref.as_str()))',
  ],
  'Claude API-key trusted host must require a provider profile and avoid legacy global secret fallback.',
);
assertMatch(
  claudeHost,
  /required_text\(req\.company_id\.as_ref\(\), "companyId"/u,
  'Claude trusted host must require companyId for project ownership checks.',
);

const builtinTools = await source('apps/desktop/src-tauri/src/builtin_tools.rs');
assertMatch(
  builtinTools,
  /pub async fn project_exists[\s\S]*?ensure_inside_workspace\(&canonical, &roots\)\.is_err\(\)[\s\S]*?tokio::fs::metadata/u,
  'desktop project exists must stat through the sandbox without reading full file content.',
);
assertIncludesAll(
  builtinTools,
  [
    'pub async fn project_read_file_lines',
    'tokio::fs::File::open',
    'BufReader::new',
    '.read(&mut buf)',
    'line_window_size_error("scan"',
    'Ok(format!("{}\\n", selected.join("\\n")))',
  ],
  'desktop read_file line windows must stream with scan caps instead of reading full lines or full file content.',
);
assertIncludesAll(
  builtinTools,
  [
    'fn resolve_project_candidate',
    'roots.len() == 1',
    'roots[0].join(input)',
    'resolve_candidate(path, cwd)',
  ],
  'desktop project file tools must resolve relative paths against a single active project root, not an arbitrary root union.',
);
assertNoMatch(
  builtinTools,
  /read_line\(&mut line\)/u,
  'desktop line-window reads must not allocate an entire unbounded line before applying byte caps.',
);
const tauriProjectFsAdapter = await source(
  'apps/desktop/renderer/src/lib/tauri-project-fs-adapter.ts',
);
assertIncludesAll(
  tauriProjectFsAdapter,
  ['commandArgs', 'const projectId = options?.projectId?.trim()', 'projectId,'],
  'Tauri fs adapter must require and pass a non-empty projectId to sandboxed project file commands.',
);
assertMatch(
  tauriProjectFsAdapter,
  /File tools need a bound project workspace/u,
  'Tauri fs adapter must fail closed when a run has no bound projectId.',
);
assertMatch(
  tauriProjectFsAdapter,
  /invoke<boolean>\('project_exists', commandArgs\(path, options\)\)/u,
  'Tauri fs adapter exists() must call project_exists instead of project_read_file.',
);
const builtinTypes = await source('packages/core/src/tools/builtin/types.ts');
assertIncludesAll(
  builtinTypes,
  ['export function fsAdapterOptions', 'projectId: context.projectId'],
  'builtin file tools must carry active projectId into FsAdapter options.',
);
const searchToolsSource = await source('packages/core/src/tools/builtin/search-tools.ts');
assertIncludesAll(
  searchToolsSource,
  ['MAX_VISITED_DIRS', 'visitedDirs < MAX_VISITED_DIRS', 'queue.length < MAX_VISITED_DIRS'],
  'search tools must bound directory traversal as well as visited files.',
);
assertIncludesAll(
  searchToolsSource,
  ['MAX_TRAVERSAL_MS', 'Date.now() - startedAt <= MAX_TRAVERSAL_MS'],
  'search tools must cap total traversal time, not only regex evaluation time.',
);
assertNoMatch(
  searchToolsSource,
  /queue\.shift\(\)/u,
  'search tools must use an index-based queue instead of O(n) queue.shift().',
);
for (const [label, fileToolSource] of [
  ['read_file', await source('packages/core/src/tools/builtin/file-read-tool.ts')],
  ['write_file', await source('packages/core/src/tools/builtin/file-write-tool.ts')],
  ['edit_file', await source('packages/core/src/tools/builtin/edit-file-tool.ts')],
  ['search tools', searchToolsSource],
]) {
  assertMatch(
    fileToolSource,
    /fsAdapterOptions\(context\)/u,
    `${label} must pass projectId-aware fs adapter options.`,
  );
}
assertIncludesAll(
  teamDock,
  [
    'fetchQuery({',
    'projectChatThreadRowsQueryKey(projectId)',
    'employee_id === employee.id',
    'return existing.thread_id',
  ],
  'TeamDock direct chat must reuse existing raw chat_thread rows instead of creating duplicates.',
);
assertMatch(
  teamDock,
  /thread\.employeeId && !map\.has\(thread\.employeeId\)/u,
  'TeamDock employee thread map must keep the newest thread returned by updated_at DESC.',
);
const officeScene2D = await source(
  'apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx',
);
assertMatch(
  officeScene2D,
  /thread\.employeeId && !map\.has\(thread\.employeeId\)/u,
  '2D office scene employee thread map must keep the newest thread returned by updated_at DESC.',
);
const tauriLib = await source('apps/desktop/src-tauri/src/lib.rs');
assertMatch(
  tauriLib,
  /builtin_tools::project_exists/u,
  'project_exists must be registered as a Tauri command.',
);
assertMatch(
  tauriLib,
  /builtin_tools::project_read_file_lines/u,
  'project_read_file_lines must be registered as a Tauri command.',
);
const fsShellPermissions = await source('apps/desktop/src-tauri/permissions/fs-shell.toml');
assertMatch(
  fsShellPermissions,
  /project_read_file_lines/u,
  'project_read_file_lines must be allowed by the fs-shell Tauri permission.',
);
assertMatch(
  fsShellPermissions,
  /project_exists/u,
  'project_exists must be allowed by the fs-shell Tauri permission.',
);

for (const [label, sidecarSource] of [
  ['dev Codex sidecar', await source('scripts/tauri-codex-agent-host.mjs')],
  ['bundled Codex sidecar', await source('apps/desktop/src-tauri/resources/codex-agent-host.mjs')],
]) {
  assertNoMatch(
    sidecarSource,
    /kind: 'checkpoint_created'/u,
    `${label} must not emit fake checkpoint_created events.`,
  );
  assertMatch(
    sidecarSource,
    /MAX_CODEX_TEXT_BYTES[\s\S]*?pushRuntimeEvent[\s\S]*?runtime_events_truncated/u,
    `${label} must cap oversized text and runtime event payloads.`,
  );
  assertMatch(
    sidecarSource,
    /MAX_CODEX_APP_SERVER_STDERR_BYTES[\s\S]*?appendCappedStderr[\s\S]*?cappedStderrText/u,
    `${label} must cap Codex app-server stderr inside the Node sidecar.`,
  );
}

const buildAgentHostLib = await source('scripts/build-agent-host-lib.mjs');
assertNoMatch(
  buildAgentHostLib,
  /--unsafe/u,
  'sidecar bundle build must not run unsafe formatter/linter fixes.',
);
assertMatch(buildAgentHostLib, /biome/u, 'sidecar bundle build should invoke Biome.');
assertIncludesAll(
  buildAgentHostLib,
  ['format', '--write'],
  'sidecar bundle build should use pure formatting only.',
);
assertIncludesAll(
  buildAgentHostLib,
  ['GENERATED_CONST_NAMES', 'MAX_CODEX_TEXT_BYTES', 'new RegExp(`^var ${name} =`'],
  'sidecar bundle build may only normalize known generated constants away from var.',
);
const bundledCodexHost = await source('apps/desktop/src-tauri/resources/codex-agent-host.mjs');
assertNoMatch(
  bundledCodexHost,
  /^var (?:MAX_CODEX_TEXT_BYTES|MAX_CODEX_REASONING_BYTES|MAX_CODEX_RUNTIME_EVENTS|TRUNCATED_SUFFIX) =/mu,
  'bundled Codex sidecar constants must not be emitted as var.',
);

console.log('review-fixes harness passed');
