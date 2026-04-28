import assert from 'node:assert/strict';
import test from 'node:test';

const { listTemplates } = await import(
  new URL('../../dist/templates/index.js', import.meta.url).href
);
const { SYSTEM_ZONE_TEMPLATES, resolveZoneForRole, templateToZone } = await import(
  new URL('../../../shared-types/dist/index.js', import.meta.url).href
);

test('all company templates seed YOLO Master', () => {
  assert.equal(
    listTemplates().every((template) =>
      template.employees.some((employee) => employee.role_slug === 'yolo_master'),
    ),
    true,
  );
});

test('all company template employee roles resolve to workspace zones', () => {
  for (const template of listTemplates()) {
    const zones = (template.zones ?? SYSTEM_ZONE_TEMPLATES).map((zone) =>
      templateToZone(zone, 'company-test'),
    );
    for (const employee of template.employees) {
      const matched = resolveZoneForRole(employee.role_slug, zones);
      assert.equal(
        matched?.archetype,
        'workspace',
        `${template.id}:${employee.role_slug} should resolve to a workspace zone`,
      );
    }
  }
});
