#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const source = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const requireText = (path, text, reason) => {
  if (!source(path).includes(text)) failures.push(`${path}: ${reason}`);
};
const forbidText = (path, text, reason) => {
  if (source(path).includes(text)) failures.push(`${path}: ${reason}`);
};

const dataPath = 'apps/desktop/renderer/src/data/git-workbench.ts';
for (const exportName of [
  'stageGitFiles',
  'commitGitChanges',
  'switchGitBranch',
  'pushGitBranch',
  'getOriginRemote',
  'getGhAuthStatus',
  'listPullRequests',
  'getPullRequestStatus',
  'viewPullRequest',
  'createPullRequest',
]) {
  requireText(dataPath, `function ${exportName}`, `missing deterministic ${exportName} binding`);
}
requireText(
  dataPath,
  "['push', '-u', 'origin', branch]",
  'push binding must pin origin/current branch',
);

const uiPath = 'apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx';
for (const contract of [
  "useState('')",
  'Stage selected',
  'Commit staged changes',
  'Create &amp; switch',
  'Confirm push',
  'Confirm pull request',
  'No origin remote is configured',
  'GitHub CLI is unavailable or not logged in',
  'commandOutput(lastOutput.result)',
  'key={projectId}',
  'projectGenerationRef',
  'operation(scope.projectId)',
  'isCurrentProjectScope(scope)',
]) {
  requireText(uiPath, contract, `missing Git/PR UI contract: ${contract}`);
}

requireText(
  'apps/desktop/src-tauri/permissions/github.toml',
  'commands.allow = ["gh_exec"]',
  'gh command must use its own narrow permission',
);
forbidText(
  'apps/desktop/src-tauri/permissions/agent-bridges.toml',
  'gh_exec',
  'delegate/agent capability must not gain gh access',
);

if (failures.length > 0) {
  console.error('[harness-git-pr-workbench] failed');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('[harness-git-pr-workbench] ok — user Git/PR loop, ask gates, and agent boundary');
