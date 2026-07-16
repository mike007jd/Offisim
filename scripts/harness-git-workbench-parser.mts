import assert from 'node:assert/strict';
import {
  classifyNonGitWorkspace,
  isNonGitWorkspace,
  parseNumstatZ,
  parseStatusPorcelainV1Z,
} from '../apps/desktop/renderer/src/data/git-workbench.ts';

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

console.log('git-workbench-parser: NUL-safe parsing and Project folder states passed');
