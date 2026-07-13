import assert from 'node:assert/strict';
import {
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

console.log('git-workbench-parser: NUL-safe status and numstat parsing passed');
