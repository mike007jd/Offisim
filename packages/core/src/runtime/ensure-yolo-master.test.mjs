import assert from 'node:assert/strict';
import test from 'node:test';

const { createMemoryRepositories } = await import(
  new URL('../../dist/runtime/memory-repositories.js', import.meta.url).href
);
const { ensureYoloMasterForActiveCompanies } = await import(
  new URL('../../dist/runtime/ensure-yolo-master.js', import.meta.url).href
);

test('ensureYoloMasterForActiveCompanies is idempotent', async () => {
  const repos = createMemoryRepositories();
  await repos.companies.create({
    company_id: 'company-yolo-ensure',
    name: 'YOLO Ensure Co',
    status: 'active',
    template_id: null,
    template_label: null,
    workspace_root: null,
    default_model_policy_json: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  await ensureYoloMasterForActiveCompanies(repos);
  await ensureYoloMasterForActiveCompanies(repos);

  const rows = await repos.employees.findByRole('company-yolo-ensure', 'yolo_master');
  assert.equal(rows.length, 1);
});
