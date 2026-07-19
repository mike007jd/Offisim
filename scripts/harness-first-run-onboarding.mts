import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_RUN_MILESTONES,
  resolveFirstRunProgress,
} from '../apps/desktop/renderer/src/surfaces/onboarding/first-run-progress.js';
import { FIRST_RUN_EXAMPLE_PROMPT } from '../apps/desktop/renderer/src/surfaces/onboarding/first-run-state.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const facts = Object.fromEntries(
  FIRST_RUN_MILESTONES.map((milestone) => [milestone, false]),
) as Record<(typeof FIRST_RUN_MILESTONES)[number], boolean>;

for (const [index, milestone] of FIRST_RUN_MILESTONES.entries()) {
  const progress = resolveFirstRunProgress(facts);
  assert.equal(progress.milestone, milestone);
  assert.equal(progress.completedCount, index);
  facts[milestone] = true;
}
assert.deepEqual(resolveFirstRunProgress(facts), { milestone: 'complete', completedCount: 6 });

assert.match(FIRST_RUN_EXAMPLE_PROMPT, /FIRST_WIN\.md/u);
assert.match(FIRST_RUN_EXAMPLE_PROMPT, /exactly three bullets/u);
assert.ok(FIRST_RUN_EXAMPLE_PROMPT.length < 500, 'example request must stay lightweight');

const sourceFiles = await Promise.all(
  [
    'apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx',
    'apps/desktop/renderer/src/surfaces/office/workspace-panel/ProjectsTab.tsx',
    'apps/desktop/renderer/src/surfaces/office/rail/ThreadList.tsx',
    'apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx',
  ].map((path) => readFile(resolve(root, path), 'utf8')),
);
for (const [index, source] of sourceFiles.entries()) {
  assert.match(
    source,
    /openFirstRunGuide/u,
    `empty-state guide entry missing from source ${index}`,
  );
}
assert.match(
  sourceFiles[3] ?? '',
  /No engine is ready\. Sign in to a detected coding tool, or add a Pi API provider below\./u,
);
assert.match(sourceFiles[3] ?? '', /account\.capabilities\.execute\.status === 'available'/u);

const guideSource = await readFile(
  resolve(root, 'apps/desktop/renderer/src/surfaces/onboarding/FirstRunGuide.tsx'),
  'utf8',
);
assert.match(guideSource, /codex login/u);
assert.match(guideSource, /add a Pi API provider and exact model/u);
assert.match(guideSource, /requestReady && liveObserved/u);
assert.match(guideSource, /option\.selectionKind === 'api-model'/u);

const commandSource = await readFile(
  resolve(root, 'apps/desktop/src-tauri/src/task_workspace_binding.rs'),
  'utf8',
);
assert.match(commandSource, /project_demo_workspace_prepare/u);
assert.match(commandSource, /PROJECT_BRIEF\.md/u);

console.log('first-run-onboarding: 21/21 checks passed');
