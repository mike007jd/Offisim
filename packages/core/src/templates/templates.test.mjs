import assert from 'node:assert/strict';
import test from 'node:test';

const { listTemplates } = await import(
  new URL('../../dist/templates/index.js', import.meta.url).href
);

test('all company templates seed YOLO Master', () => {
  assert.equal(
    listTemplates().every((template) =>
      template.employees.some((employee) => employee.role_slug === 'yolo_master'),
    ),
    true,
  );
});
