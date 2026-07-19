import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyNonGitWorkspace,
  isNonGitWorkspace,
  parseNumstatZ,
  parseStatusPorcelainV1Z,
} from '../apps/desktop/renderer/src/data/git-workbench.ts';
import {
  buildReturnedReviewPatch,
  reconcileReviewState,
  summarizeReview,
} from '../apps/desktop/renderer/src/data/review-workbench.ts';
import {
  buildUnifiedPatch,
  diffRevision,
  parseUnifiedDiffFiles,
} from '../apps/desktop/renderer/src/data/unified-diff.ts';

const status = [
  '## main...origin/main [ahead 2, behind 1]',
  ' M  leading "quote" 文件.txt',
  'R  new -> literal.txt',
  'old name.txt',
  '?? newline\nfile.txt',
  '',
].join('\0');
const parsedStatus = parseStatusPorcelainV1Z(status);
assert.equal(parsedStatus.header, '## main...origin/main [ahead 2, behind 1]');
assert.deepEqual(
  parsedStatus.changes.map(({ path, status: state, staged }) => ({ path, state, staged })),
  [
    { path: ' leading "quote" 文件.txt', state: 'modified', staged: false },
    { path: 'new -> literal.txt', state: 'renamed', staged: true },
    { path: 'newline\nfile.txt', state: 'added', staged: false },
  ],
);

const parsedStats = parseNumstatZ(
  '1\t2\t leading\t文件\n.txt\0' + '5\t6\t\0old -> path\0new -> path\0' + '-\t-\tbinary.dat\0',
);
assert.deepEqual(parsedStats.get(' leading\t文件\n.txt'), { added: 1, removed: 2 });
assert.deepEqual(parsedStats.get('new -> path'), { added: 5, removed: 6 });
assert.deepEqual(parsedStats.get('binary.dat'), { added: 0, removed: 0 });

const noProjectFolder = 'No authorized Project folder is selected for this Project.';
assert.equal(isNonGitWorkspace(noProjectFolder), true);
assert.deepEqual(classifyNonGitWorkspace(noProjectFolder), { status: 'unbound' });

const missingProjectFolder = 'Resolve project workspace: No such file or directory';
assert.equal(isNonGitWorkspace(missingProjectFolder), true);
assert.deepEqual(classifyNonGitWorkspace(missingProjectFolder), { status: 'invalid-folder' });

const replacedProjectFolder = 'Project folder identity changed after it was selected.';
assert.equal(isNonGitWorkspace(replacedProjectFolder), true);
assert.deepEqual(classifyNonGitWorkspace(replacedProjectFolder), { status: 'invalid-folder' });

const uninitialized = 'fatal: not a git repository';
assert.equal(isNonGitWorkspace(uninitialized), true);
assert.deepEqual(classifyNonGitWorkspace(uninitialized), { status: 'uninitialized' });
assert.equal(
  isNonGitWorkspace('No workspace_root is bound'),
  false,
  'deleted backend wording must not remain a hidden UI protocol',
);
assert.equal(
  isNonGitWorkspace('Read Project folder authority: database is locked'),
  false,
  'authority/database failures must stay visible as errors instead of routing to Change folder',
);

const multiFileDiff = [
  'diff --git a/src/alpha.ts b/src/alpha.ts',
  'index 1111111..2222222 100644',
  '--- a/src/alpha.ts',
  '+++ b/src/alpha.ts',
  '@@ -1,3 +1,4 @@ export function alpha() {',
  ' const unchanged = true;',
  '-const value = 1;',
  '+const value = 2;',
  '+const added = true;',
  ' return value;',
  '@@ -20,2 +21,2 @@ export function omega() {',
  '-return "old";',
  '+return "new";',
  ' }',
  'diff --git a/src/old name.ts b/src/new name.ts',
  'similarity index 80%',
  'rename from src/old name.ts',
  'rename to src/new name.ts',
  '--- a/src/old name.ts',
  '+++ b/src/new name.ts',
  '@@ -1 +1 @@',
  '-old name',
  '+new name',
  '\\ No newline at end of file',
].join('\n');

const addedDeletedAndBinary = [
  'diff --git a/dev/null b/src/new.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-gone',
  '-forever',
  'diff --git a/assets/logo.png b/assets/logo.png',
  'new file mode 100644',
  'index 0000000..5555555',
  'Binary files /dev/null and b/assets/logo.png differ',
].join('\n');

const document = parseUnifiedDiffFiles([multiFileDiff, addedDeletedAndBinary]);
assert.equal(document.files.length, 5, 'one input may contain multiple diff --git sections');
assert.equal(document.additions, 6);
assert.equal(document.deletions, 5);
assert.equal(document.revision, diffRevision([multiFileDiff, addedDeletedAndBinary]));
assert.equal(document.revision, diffRevision(document));

const alpha = document.files[0];
assert.ok(alpha);
assert.deepEqual(
  {
    path: alpha.path,
    oldPath: alpha.oldPath,
    newPath: alpha.newPath,
    status: alpha.status,
    additions: alpha.additions,
    deletions: alpha.deletions,
    hunkCount: alpha.hunks.length,
  },
  {
    path: 'src/alpha.ts',
    oldPath: 'src/alpha.ts',
    newPath: 'src/alpha.ts',
    status: 'modified',
    additions: 3,
    deletions: 2,
    hunkCount: 2,
  },
);
assert.deepEqual(
  alpha.hunks[0]?.lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })),
  [
    { kind: 'context', oldLine: 1, newLine: 1 },
    { kind: 'remove', oldLine: 2, newLine: undefined },
    { kind: 'add', oldLine: undefined, newLine: 2 },
    { kind: 'add', oldLine: undefined, newLine: 3 },
    { kind: 'context', oldLine: 3, newLine: 4 },
  ],
);
const firstHunk = alpha.hunks[0];
assert.ok(firstHunk);
assert.equal(
  buildUnifiedPatch(alpha, [firstHunk.id]),
  `${alpha.headers.join('\n')}\n${firstHunk.patch}`,
);
assert.equal(buildUnifiedPatch(alpha), alpha.patch);
assert.equal(buildUnifiedPatch(alpha, []), '');

const review = {
  revision: document.revision,
  decisions: {
    [firstHunk.id]: 'returned' as const,
    [alpha.hunks[1]?.id ?? 'missing']: 'accepted' as const,
  },
  annotations: [
    {
      id: 'comment-1',
      fileId: alpha.id,
      hunkId: firstHunk.id,
      lineId: firstHunk.lines[1]?.id ?? null,
      path: alpha.path,
      label: firstHunk.header,
      body: 'Keep the public name stable.',
      state: 'submitted' as const,
    },
  ],
};
assert.equal(buildReturnedReviewPatch(document, review), buildUnifiedPatch(alpha, [firstHunk.id]));
const alreadyAppliedReview = { ...review, appliedReturnAnchors: [firstHunk.id] };
assert.equal(
  buildReturnedReviewPatch(document, alreadyAppliedReview),
  '',
  'a reverse patch already applied before a steer failure must not be applied twice on retry',
);
assert.deepEqual(
  reconcileReviewState(document, alreadyAppliedReview).appliedReturnAnchors,
  [firstHunk.id],
  'an applied return remains durable while its stale diff anchor is still projected',
);
const multiReturnDocument = parseUnifiedDiffFiles([
  multiFileDiff,
  [
    'diff --git a/src/beta.ts b/src/beta.ts',
    'index 7777777..8888888 100644',
    '--- a/src/beta.ts',
    '+++ b/src/beta.ts',
    '@@ -1 +1 @@',
    '-old beta',
    '+new beta',
  ].join('\n'),
]);
const beta = multiReturnDocument.files.at(-1);
assert.ok(beta);
const betaHunk = beta.hunks[0];
assert.ok(betaHunk);
assert.equal(
  buildReturnedReviewPatch(multiReturnDocument, {
    revision: multiReturnDocument.revision,
    decisions: { [firstHunk.id]: 'returned', [betaHunk.id]: 'returned' },
    annotations: [],
  }),
  `${buildUnifiedPatch(alpha, [firstHunk.id])}${buildUnifiedPatch(beta, [betaHunk.id])}`,
  'multi-file review patches must preserve canonical git section boundaries without blank lines',
);
assert.equal(reconcileReviewState(document, review).annotations[0]?.state, 'submitted');
assert.equal(
  reconcileReviewState({ ...document, revision: 'employee-returned-new-diff' }, review)
    .annotations[0]?.state,
  'submitted',
  'an unrelated diff revision must not mark an unchanged review anchor handled',
);
assert.equal(
  reconcileReviewState(
    {
      ...document,
      files: document.files.filter((file) => file.id !== alpha.id),
      revision: 'employee-removed-reviewed-anchor',
    },
    review,
  ).annotations[0]?.state,
  'resolved',
);
assert.equal(
  reconcileReviewState(
    { ...document, revision: 'steer-failed' },
    { ...review, annotations: [{ ...review.annotations[0], state: 'draft' }] },
  ).annotations[0]?.state,
  'draft',
);
assert.equal(summarizeReview(document, review).openAnnotations, 1);
const fileReview = {
  revision: document.revision,
  decisions: { [alpha.id]: 'returned' as const },
  annotations: [
    {
      ...review.annotations[0],
      id: 'file-comment',
      fileId: alpha.id,
      hunkId: alpha.id,
      lineId: null,
      label: 'Entire file',
    },
  ],
};
const changedFileReview = reconcileReviewState(
  {
    ...document,
    files: document.files.map((file) =>
      file.id === alpha.id ? { ...file, id: 'file-content-changed' } : file,
    ),
    revision: 'same-path-file-content-changed',
  },
  fileReview,
);
assert.equal(changedFileReview.annotations[0]?.state, 'resolved');
assert.equal(changedFileReview.decisions[alpha.id], undefined);

const renamed = document.files[1];
assert.ok(renamed);
assert.equal(renamed.status, 'renamed');
assert.equal(renamed.supportsPartialPatch, false);
assert.equal(buildUnifiedPatch(renamed, [renamed.hunks[0]?.id ?? 'missing']), '');
assert.equal(renamed.oldPath, 'src/old name.ts');
assert.equal(renamed.newPath, 'src/new name.ts');
const noNewline = renamed.hunks[0]?.lines.at(-1);
assert.ok(noNewline);
assert.deepEqual(
  {
    kind: noNewline.kind,
    text: noNewline.text,
    oldLine: noNewline.oldLine,
    newLine: noNewline.newLine,
  },
  { kind: 'meta', text: 'No newline at end of file', oldLine: undefined, newLine: undefined },
);

const added = document.files[2];
const deleted = document.files[3];
const binary = document.files[4];
assert.ok(added && deleted && binary);
assert.equal(added.status, 'added');
assert.equal(added.supportsPartialPatch, false);
assert.equal(added.oldPath, null);
assert.equal(deleted.status, 'deleted');
assert.equal(deleted.newPath, null);
assert.equal(binary.binary, true);
assert.equal(binary.supportsPartialPatch, false);
assert.equal(binary.status, 'added');
assert.equal(binary.additions, 0);
assert.equal(binary.deletions, 0);

const reparsed = parseUnifiedDiffFiles([multiFileDiff, addedDeletedAndBinary]);
assert.deepEqual(
  reparsed.files.flatMap((file) => [
    file.id,
    ...file.hunks.flatMap((hunk) => [hunk.id, ...hunk.lines.map((line) => line.id)]),
  ]),
  document.files.flatMap((file) => [
    file.id,
    ...file.hunks.flatMap((hunk) => [hunk.id, ...hunk.lines.map((line) => line.id)]),
  ]),
  'file, hunk, and line anchors must remain stable for the same diff',
);
assert.equal(buildUnifiedPatch(alpha, [firstHunk.id, 'stale-hunk-id']), '');

const quotedUnicode = parseUnifiedDiffFiles([
  [
    'diff --git "a/\\346\\226\\207\\344\\273\\266.ts" "b/\\346\\226\\207\\344\\273\\266.ts"',
    '--- "a/\\346\\226\\207\\344\\273\\266.ts"',
    '+++ "b/\\346\\226\\207\\344\\273\\266.ts"',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n'),
]);
assert.equal(quotedUnicode.files[0]?.path, '文件.ts', 'git octal-quoted UTF-8 paths must decode');

const rawUnicode = parseUnifiedDiffFiles([
  [
    'diff --git "a/文件.ts" "b/文件.ts"',
    '--- "a/文件.ts"',
    '+++ "b/文件.ts"',
    '@@ -1 +1 @@',
    '-旧',
    '+新',
  ].join('\n'),
]);
assert.equal(rawUnicode.files[0]?.path, '文件.ts', 'quoted raw Unicode paths must remain intact');

const workspacePanelSource = [
  readFileSync(
    new URL('../apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx', import.meta.url),
    'utf8',
  ),
  readFileSync(
    new URL(
      '../apps/desktop/renderer/src/surfaces/office/workspace-panel/GitTab.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
].join('\n');
const stageViewerSource = [
  readFileSync(
    new URL(
      '../apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
  readFileSync(
    new URL(
      '../apps/desktop/renderer/src/surfaces/office/stage-viewer/views/ChangesView.tsx',
      import.meta.url,
    ),
    'utf8',
  ),
].join('\n');
const reviewStageSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/surfaces/office/board/ReviewWorkbenchStage.tsx',
    import.meta.url,
  ),
  'utf8',
);
const reviewCssSource = readFileSync(
  new URL('../apps/desktop/renderer/src/surfaces/office/board/board.css', import.meta.url),
  'utf8',
);
const officeCssSource = readFileSync(
  new URL('../apps/desktop/renderer/src/surfaces/office/office.css', import.meta.url),
  'utf8',
);
const diffPanelSource = readFileSync(
  new URL('../apps/desktop/renderer/src/surfaces/office/board/DiffPanel.tsx', import.meta.url),
  'utf8',
);
const reviewPrefillSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/surfaces/office/board/review-pr-prefill.ts',
    import.meta.url,
  ),
  'utf8',
);
assert.doesNotMatch(
  workspacePanelSource,
  /<DiffPanel\b/u,
  'the narrow workspace rail must never own the review diff body',
);
assert.match(workspacePanelSource, /Open review stage/u);
assert.match(stageViewerSource, /<ReviewWorkbenchStage/u);
assert.match(stageViewerSource, /setOfficeStageMaximized\(true\)/u);
assert.match(
  stageViewerSource,
  /state\.officeStageMaximizedVersion === reviewPresentationOwnerVersion/u,
  'review presentation may restore the stage only while it still owns the maximize state',
);
assert.match(reviewStageSource, /mode=\{actionable \? 'review' : 'readonly'\}/u);
assert.match(reviewStageSource, /publishReviewPrPrefill/u);
assert.match(
  reviewPrefillSource,
  /__offisimReviewPrPrefillStore__/u,
  'the PR handoff must survive lazy Stage and workspace rail mount order',
);
assert.match(reviewPrefillSource, /globalThis/u);
assert.doesNotMatch(
  diffPanelSource,
  /\[document\.files, initialPath, selectedPath\]/u,
  'the initial file hint must not reset a user-selected file on every selection',
);
assert.match(
  reviewCssSource,
  /grid-template-columns: minmax\(190px, 20%\) minmax\(0, 1fr\) minmax\(270px, 24%\)/u,
  'the wide review stage must keep file tree, diff, and review inspector as three peers',
);
assert.match(officeCssSource, /\.off-gw-pr-create[\s\S]*white-space: nowrap/u);

console.log(
  'git-workbench-parser: porcelain, structured review, stage ownership, and stable anchors passed',
);
