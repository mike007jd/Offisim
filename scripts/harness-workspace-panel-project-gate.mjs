import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelPath = 'apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx';
const projectDialogPath = 'apps/desktop/renderer/src/surfaces/office/ProjectDialog.tsx';
const lifecyclePath = 'apps/desktop/renderer/src/surfaces/lifecycle/LifecycleSurface.tsx';
const wizardPath = 'apps/desktop/renderer/src/surfaces/lifecycle/CompanyCreationWizard.tsx';
const projectsRepoPath = 'apps/desktop/renderer/src/lib/tauri-repos/projects.ts';
const desktopDialogPath = 'apps/desktop/renderer/src/lib/desktop-dialog.ts';
const capabilitiesPath = 'apps/desktop/renderer/src/assistant/runtime/use-thread-capabilities.ts';
const requireProjectWorkspacePath =
  'apps/desktop/renderer/src/runtime/require-project-workspace.ts';
const recoveryPanelPath = 'apps/desktop/renderer/src/surfaces/office/RecoveryPanel.tsx';
const source = readFileSync(panelPath, 'utf8');
const workspacePanel = source.slice(source.indexOf('export function WorkspacePanel()'));
const projectDialog = readFileSync(projectDialogPath, 'utf8');
const lifecycle = readFileSync(lifecyclePath, 'utf8');
const wizard = readFileSync(wizardPath, 'utf8');
const projectsRepo = readFileSync(projectsRepoPath, 'utf8');
const desktopDialog = readFileSync(desktopDialogPath, 'utf8');
const capabilities = readFileSync(capabilitiesPath, 'utf8');
const requireProjectWorkspace = readFileSync(requireProjectWorkspacePath, 'utf8');
const recoveryPanel = readFileSync(recoveryPanelPath, 'utf8');

assert.match(
  source,
  /return activeProjectId\?\.trim\(\) \? requestedTab : 'projects';/u,
  'no active Project must resolve every requested tab to Projects',
);
assert.match(
  workspacePanel,
  /const activeProjectId = project\?\.id \?\? null;\s+const git = useGitWorkbench\(activeProjectId\);/u,
  'Git query scope must be null until an active Project row is resolved',
);
assert.doesNotMatch(
  workspacePanel,
  /useGitWorkbench\(projectId\)/u,
  'the empty UI project id must never reach the Git query',
);
assert.match(
  workspacePanel,
  /disabled=\{t\.id !== 'projects' && !project\}/u,
  'Files and Git tabs must stay disabled without an active Project',
);
assert.equal(
  (workspacePanel.match(/disabled=\{!project\}/gu) ?? []).length,
  2,
  'collapsed Files and Git actions must stay disabled without an active Project',
);

const noProjectStart = workspacePanel.indexOf(') : !project ? (');
const filesStart = workspacePanel.indexOf(") : tab === 'files' ? (");
assert.ok(noProjectStart >= 0 && filesStart > noProjectStart, 'missing no-active-Project gate');
const noProjectState = workspacePanel.slice(noProjectStart, filesStart);
assert.match(noProjectState, /title="No active project"/u);
assert.match(noProjectState, /label: 'New project'/u);
assert.doesNotMatch(
  noProjectState,
  /Bind folder/u,
  'a no-Project empty state cannot offer an action guaranteed to fail',
);

assert.match(
  workspacePanel,
  /<FilesTab\s+projectId=\{project\.id\}/u,
  'Files must receive only a resolved Project id',
);
assert.match(
  workspacePanel,
  /<GitTab\s+key=\{project\.id\}[\s\S]*?projectId=\{project\.id\}/u,
  'Git must receive only a resolved Project id',
);

for (const obsoleteCopy of [
  "'No folder bound'",
  'title="No workspace bound"',
  'title="Workspace folder not found"',
  "label: 'Bind folder'",
  "label: 'Rebind folder'",
]) {
  assert.ok(!source.includes(obsoleteCopy), `obsolete workspace copy remains: ${obsoleteCopy}`);
}
assert.match(source, /title="No Project folder"/u);
assert.match(source, /title="Project folder not found"/u);
assert.match(source, /label: 'Choose folder'/u);
assert.match(source, /label: 'Change folder'/u);
assert.match(source, /Choose the folder that contains this Project’s files\./u);
assert.match(source, /Create a Project and choose where its files live\./u);
assert.match(source, /toast\.error\('Choose a Project first\.'\)/u);
assert.doesNotMatch(
  source,
  /file context for runs|Select a project before binding a folder|Rebind/u,
);

const missingFolderStart = workspacePanel.indexOf("git.data?.status === 'invalid-folder'");
const unboundFolderStart = workspacePanel.indexOf(
  '// Project has no chosen folder',
  missingFolderStart,
);
assert.ok(
  missingFolderStart >= 0 && unboundFolderStart > missingFolderStart,
  'missing Project folder state must remain explicit',
);
const missingFolderState = workspacePanel.slice(missingFolderStart, unboundFolderStart);
assert.match(missingFolderState, /Project folder was moved, deleted, or can no longer be read/u);
assert.match(missingFolderState, /label: 'Change folder'/u);

assert.match(
  workspacePanel,
  /invokeCommand\('project_update',[\s\S]*?workspaceSelectionRef: folder\.selectionRef/u,
  'WorkspacePanel must consume the native one-shot folder selection',
);
assert.doesNotMatch(workspacePanel, /project_workspace_canonicalize|repos\.projects\.update\(/u);

const nameField = projectDialog.indexOf('htmlFor={nameId}');
const folderField = projectDialog.indexOf('htmlFor={workspaceRootId}');
const verifyField = projectDialog.indexOf('htmlFor={verifyCommandId}');
const conditionalLimits = projectDialog.indexOf('{verifyCommand.trim() ? (');
const attemptsField = projectDialog.indexOf('htmlFor={verifyAttemptsId}');
assert.ok(
  nameField >= 0 &&
    folderField > nameField &&
    verifyField > folderField &&
    conditionalLimits > verifyField &&
    attemptsField > conditionalLimits,
  'Project dialog must scan Name → Project folder → optional Verify → conditional limits',
);
assert.match(projectDialog, /Verify command[\s\S]*?\(optional\)/u);
assert.match(
  projectDialog,
  /id=\{workspaceRootId\}[\s\S]*?value=\{workspaceRoot\}[\s\S]*?readOnly/u,
  'Project folder display must not accept typed paths',
);
assert.match(projectDialog, /workspaceSelectionRef: workspaceSelection\.selectionRef/u);
assert.match(projectDialog, /workspaceSelectionRef: workspaceSelection\?\.selectionRef \?\? null/u);
assert.match(projectDialog, /const verifyEnabled = cleanVerifyCommand !== null;/u);
assert.match(
  projectDialog,
  /const cleanVerifyMaxAttempts = verifyEnabled \? Number\.parseInt\(verifyMaxAttempts, 10\) : 3;/u,
  'clearing Verify must reset hidden attempts to the default',
);
assert.match(
  projectDialog,
  /verifyEnabled && verifyTokenBudget\.trim\(\)[\s\S]*?: null;/u,
  'clearing Verify must reset the hidden token budget',
);
assert.equal(
  (projectDialog.match(/verifyEnabled &&/gu) ?? []).length,
  3,
  'both advanced-field validation branches and token normalization must require Verify',
);

assert.match(wizard, /setWorkspaceSelectionRef\(folder\.selectionRef\)/u);
assert.match(
  wizard,
  /setWorkspaceRoot\(''\);\s+setWorkspaceSelectionRef\(null\);/u,
  'clearing the wizard Project folder must also clear its native claim',
);
assert.match(wizard, /id="off-wiz-workspace"[\s\S]*?readOnly/u);
assert.match(lifecycle, /invokeCommand\('project_create'/u);
assert.doesNotMatch(lifecycle, /repos\.projects\.create\(/u);

assert.match(desktopDialog, /invokeCommand\('project_workspace_select'/u);
assert.match(projectsRepo, /Project creation requires a native folder selection/u);
assert.match(projectsRepo, /Changing a Project folder requires a fresh native folder selection/u);
for (const productSource of [
  source,
  projectDialog,
  lifecycle,
  wizard,
  projectsRepo,
  desktopDialog,
]) {
  assert.doesNotMatch(productSource, /project_workspace_canonicalize/u);
}

for (const obsoleteCapabilityCopy of [
  'Pi runtime',
  'Files & workspace',
  'at workspace root',
  'Workspace folder bound',
  'No workspace folder bound for this project',
  'Bind a folder',
  'Rebind folder',
  'Sandboxed shell inside the bound workspace',
  'Shell commands need a bound workspace folder',
]) {
  assert.ok(
    !capabilities.includes(obsoleteCapabilityCopy),
    `obsolete capability copy remains: ${obsoleteCapabilityCopy}`,
  );
}
assert.match(
  capabilities,
  /type CapabilitySource = 'Project' \| 'MCP grant' \| 'Workspace' \| 'Settings';/u,
);
assert.equal((capabilities.match(/source: 'Project'/gu) ?? []).length, 4);
assert.equal((capabilities.match(/setup: \{ label: 'Choose folder'/gu) ?? []).length, 2);
assert.match(capabilities, /label: 'Project files'/u);
assert.match(capabilities, /in Project folder/u);
assert.match(capabilities, /Project folder ready/u);
assert.match(capabilities, /No Project folder chosen/u);
assert.match(capabilities, /Commands run in this Project folder/u);
assert.match(capabilities, /Choose a Project folder to use Terminal/u);

assert.match(requireProjectWorkspace, /Choose a Project and its folder before starting work\./u);
assert.equal(
  (
    requireProjectWorkspace.match(
      /The selected Project is unavailable\. Choose another Project\./gu,
    ) ?? []
  ).length,
  2,
);
assert.match(requireProjectWorkspace, /Workspace availability and recovery are backend authority/u);
assert.doesNotMatch(
  requireProjectWorkspace,
  /project\.workspace_root|This Project folder is unavailable/u,
  'renderer preflight must not block Conversation-only fallback before backend recovery runs',
);
assert.doesNotMatch(
  requireProjectWorkspace,
  /new Error\(`[^`]*\$\{(?:projectId|companyId)\}/u,
  'Project selection errors must not expose internal ids',
);

assert.match(recoveryPanel, /toast\.error\(failureTitle/u);
assert.match(recoveryPanel, /aria-expanded=\{showAll\}/u);
assert.match(recoveryPanel, /`\+\$\{cards\.length - 4\} more`/u);
assert.match(recoveryPanel, />\s*Details\s*</u);
assert.doesNotMatch(recoveryPanel, /View partial|card\.sessionFile|\.slice\(0, 8\)/u);
assert.doesNotMatch(
  recoveryPanel,
  /partialUsageJson\.(?:slice|trim)|description:\s*safeErrorMessage/u,
  'Recovery UI must not expose raw usage, native session refs, or backend error details',
);

console.log('workspace-panel-project-gate: PASS');
