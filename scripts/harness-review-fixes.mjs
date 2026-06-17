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

const queries = await source('apps/desktop/renderer/src/data/queries.ts');
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
  /let projectId: string \| null = null;[\s\S]*?await ensureCompanyWorkspaceProjectId\(repos, company\.id\);[\s\S]*?setCompany\(company\.id\)/u,
  'enterCompany must provision project/workspace before mutating active state.',
);
assertMatch(
  companySelection,
  /setCompany\(company\.id\);[\s\S]*?setProject\(projectId \?\? ''\);[\s\S]*?setSurface\('office'\)/u,
  'enterCompany must update active state only after provisioning succeeds.',
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

const runtimeSecrets = await source('apps/desktop/src-tauri/src/runtime_secrets.rs');
assertMatch(
  runtimeSecrets,
  /id: "claude-code-local"\.into\(\)[\s\S]*?execution_lane: "claude-agent-sdk"\.into\(\)[\s\S]*?auth_mode: "local-auth"\.into\(\)/u,
  'runtime profiles must expose a claude-code-local local-auth profile.',
);
assertMatch(
  runtimeSecrets,
  /profile\.has_credential = if profile\.auth_mode == "local-auth" \{[\s\S]*?false/u,
  'local-auth runtime profiles must not require a stored provider secret.',
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

console.log('review-fixes harness passed');
