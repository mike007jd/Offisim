/**
 * PE1 gate — wire employee versions on a normal Profile/Appearance save.
 *
 * Before PE1, a normal employee edit in PersonnelSurface called
 * `employees.update(...)` directly and never recorded an `EmployeeVersionService`
 * version, so the History tab was effectively dead (only `created`/`rollback`
 * ever produced rows, and create recorded nothing). This harness pins the
 * version-on-save behavior of `recordEmployeeVersionOnSave` against a real
 * in-memory backend and reads it back through the same projection the History
 * tab consumes (`useEmployeeVersions`' `employeeHistoryFromRows`, exercised here
 * via the repo `findByEmployee` it calls).
 *
 * Asserts:
 *  - a fresh employee has zero versions (the dead state the surface showed);
 *  - the FIRST tracked save records a `create` baseline (pre-edit) + an `update`
 *    (post-edit) → History shows a real diff, not "No changes yet";
 *  - the v1→v2 diff carries the field that actually changed (name);
 *  - a SECOND save appends one `update` (v3) and does NOT re-baseline;
 *  - the latest version's snapshot reflects the persisted post-edit state.
 *
 * Pure Node via tsx against renderer source — the adapters-mock loader stubs the
 * Tauri-only `data/adapters.js` so the renderer data module imports in Node.
 */
import './harness-employee-version-on-save.loader-register.mjs';

import { createMemoryRepositories } from '../packages/core/src/browser.js';
import { recordEmployeeVersionOnSave } from '../apps/desktop/renderer/src/surfaces/personnel/personnel-data.js';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseSnapshot(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const repos = createMemoryRepositories();
  const companyId = 'co-acme';

  // The memory employee repo has no FK validation, so the version service's
  // employee re-read works against the created row directly (no company seed
  // needed). createVersion reads company_id off the employee row for its event.
  const { employee_id } = await repos.employees.create({
    company_id: companyId,
    name: 'Mara Quinn',
    role_slug: 'frontend',
    source_asset_id: null,
    source_package_id: null,
    persona_json: JSON.stringify({ profile: { workingStyle: 'collaborative' } }),
    config_json: '{}',
  });

  // ── 0. Fresh employee: the dead state the surface used to show. ──
  const before = await repos.employeeVersions.findByEmployee(employee_id);
  check('fresh employee has no versions (the pre-PE1 dead state)', before.length === 0);

  // ── 1. First tracked save: rename + persona edit. ──
  await recordEmployeeVersionOnSave({
    repos,
    employeeId: employee_id,
    performUpdate: () =>
      repos.employees.update(employee_id, {
        name: 'Mara Q.',
        role_slug: 'frontend',
        enabled: 1,
        persona_json: JSON.stringify({ profile: { workingStyle: 'detail-oriented' } }),
      }),
  });

  const afterFirst = await repos.employeeVersions.findByEmployee(employee_id);
  check('first save records two versions (baseline + update)', afterFirst.length === 2, `got ${afterFirst.length}`);

  const sorted = [...afterFirst].sort((a, b) => a.version_num - b.version_num);
  const [v1, v2] = sorted;
  check('v1 is a create baseline', v1?.change_type === 'create', v1?.change_type);
  check('v2 is an update', v2?.change_type === 'update', v2?.change_type);
  check('version numbers are 1,2', v1?.version_num === 1 && v2?.version_num === 2);

  // History needs ≥2 versions to render a diff (HistoryTab shows "No changes
  // yet" at 1). The before/after snapshots must differ on the edited field.
  const v1Snap = parseSnapshot(v1!.snapshot_json);
  const v2Snap = parseSnapshot(v2!.snapshot_json);
  check('baseline snapshot has the pre-edit name', v1Snap.name === 'Mara Quinn', String(v1Snap.name));
  check('update snapshot has the post-edit name', v2Snap.name === 'Mara Q.', String(v2Snap.name));
  check('the real edit is visible as a name diff', v1Snap.name !== v2Snap.name);
  check(
    'persona edit is captured in the snapshot diff',
    v1Snap.persona_json !== v2Snap.persona_json,
  );

  // ── 2. Second save: appends ONE update, never re-baselines. ──
  await recordEmployeeVersionOnSave({
    repos,
    employeeId: employee_id,
    performUpdate: () =>
      repos.employees.update(employee_id, {
        name: 'Mara Q.',
        role_slug: 'frontend',
        enabled: 0,
        persona_json: JSON.stringify({ profile: { workingStyle: 'autonomous' } }),
      }),
  });

  const afterSecond = await repos.employeeVersions.findByEmployee(employee_id);
  check('second save appends exactly one version (no re-baseline)', afterSecond.length === 3, `got ${afterSecond.length}`);
  const createCount = afterSecond.filter((r) => r.change_type === 'create').length;
  check('still exactly one create baseline', createCount === 1, `got ${createCount}`);

  const latest = [...afterSecond].sort((a, b) => b.version_num - a.version_num)[0];
  check('latest is v3 update', latest?.version_num === 3 && latest.change_type === 'update');
  const latestSnap = parseSnapshot(latest!.snapshot_json);
  check('latest snapshot reflects the persisted post-edit state (enabled=0)', latestSnap.enabled === 0, String(latestSnap.enabled));

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('harness crashed:', err);
  process.exit(1);
});
