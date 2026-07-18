import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextEmployeeIdAfterDelete } from '../apps/desktop/renderer/src/surfaces/personnel/personnel-deletion.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;

function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`✓ ${name}`);
}

check('deleting a middle employee selects the next employee', () => {
  assert.equal(nextEmployeeIdAfterDelete(['alex', 'mara', 'jo'], 'mara'), 'jo');
});

check('deleting the last employee selects the previous employee', () => {
  assert.equal(nextEmployeeIdAfterDelete(['alex', 'mara', 'jo'], 'jo'), 'mara');
});

check('deleting the only employee clears selection', () => {
  assert.equal(nextEmployeeIdAfterDelete(['alex'], 'alex'), null);
});

check('an already-removed employee falls back to the first current employee', () => {
  assert.equal(nextEmployeeIdAfterDelete(['alex', 'mara'], 'missing'), 'alex');
});

const personnelSurface = [
  readFileSync(
    join(root, 'apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx'),
    'utf8',
  ),
  readFileSync(
    join(root, 'apps/desktop/renderer/src/surfaces/personnel/EmployeeDetail.tsx'),
    'utf8',
  ),
].join('\n');
const schema = readFileSync(join(root, 'packages/db-local/src/schema.sql'), 'utf8');

check('the routine save bar contains Reset and Save but no Delete action', () => {
  const start = personnelSurface.indexOf("className={cn('off-pers-savebar'");
  const end = personnelSurface.indexOf('</div>', start);
  assert.ok(start >= 0 && end > start);
  const saveBar = personnelSurface.slice(start, end);
  assert.match(saveBar, />\s*Reset\s*</);
  assert.match(saveBar, /'Saving…' : 'Save'/);
  assert.doesNotMatch(saveBar, /Delete/);
});

check('deletion lives in an accessible header Danger Zone menu', () => {
  assert.match(personnelSurface, /aria-label={`Actions for \${employee\.name}`}/);
  assert.match(personnelSurface, /<DropdownMenuLabel>Danger Zone<\/DropdownMenuLabel>/);
  assert.match(personnelSurface, /Delete employee…/);
  assert.match(personnelSurface, /onSelect=\{onDeleteRequest\}/);
});

check('the confirmation dialog names the exact object and puts Cancel first', () => {
  const start = personnelSurface.indexOf('<DialogTitle>Delete {employee.name}?');
  const end = personnelSurface.indexOf('</DialogFooter>', start);
  assert.ok(start >= 0 && end > start);
  const dialog = personnelSurface.slice(start, end);
  assert.match(dialog, /from Personnel and Office/);
  assert.match(dialog, /Past work and conversations\s+stay readable/);
  assert.ok(dialog.indexOf('Cancel') < dialog.indexOf('`Delete ${employee.name}`'));
});

check('delete is guarded against double submission and refreshes the roster', () => {
  assert.match(personnelSurface, /if \(isDeleting\) return/);
  assert.match(personnelSurface, /await repos\.employees\.delete\(employee\.id\)/);
  assert.match(personnelSurface, /onDeleted\(\)/);
  assert.match(personnelSurface, /invalidateQueries\(\{ queryKey: \['employees', companyId\] \}\)/);
});

check('post-delete selection uses the visible roster and failure is not rendered twice', () => {
  assert.match(
    personnelSurface,
    /nextEmployeeIdAfterDelete\(visibleEmployeeIdsRef\.current, selected\.id\)/,
  );
  assert.doesNotMatch(personnelSurface, /setDeleteError|off-pers-delete-error/);
  assert.match(personnelSurface, /toast\.error\('Employee delete failed'/);
});

check('work and conversation history keeps readable employee references', () => {
  for (const expected of [
    'employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
    'from_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
    'to_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
    'direct_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
    'sender_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
    'employee_id        TEXT REFERENCES employees(employee_id) ON DELETE SET NULL',
  ]) {
    assert.ok(schema.includes(expected), `missing history-preserving FK: ${expected}`);
  }
});

check('employee-owned mutable state is removed with the employee', () => {
  assert.match(
    schema,
    /CREATE TABLE IF NOT EXISTS employee_versions[\s\S]*?employee_id\s+TEXT NOT NULL REFERENCES employees\(employee_id\) ON DELETE CASCADE/,
  );
  assert.match(
    schema,
    /CREATE TABLE IF NOT EXISTS project_assignments[\s\S]*?employee_id\s+TEXT NOT NULL REFERENCES employees\(employee_id\) ON DELETE CASCADE/,
  );
});

console.log(`\nPersonnel Danger Zone harness: ${passed}/11 checks passed`);
