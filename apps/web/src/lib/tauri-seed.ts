import { getTauriDb } from './tauri-db';

/**
 * Seed the Tauri SQLite database with default company + employees
 * on first launch. Checks if already seeded by looking for company-001.
 *
 * Wrapped in a transaction so partial failure doesn't leave dirty state.
 */
export async function seedTauriDb(): Promise<void> {
  const db = await getTauriDb();

  // Check if already seeded
  const existing = (await db.select('SELECT company_id FROM companies WHERE company_id = $1', [
    'company-001',
  ])) as { company_id: string }[];
  if (existing.length > 0) return;

  const now = new Date().toISOString();

  await db.execute('BEGIN');
  try {
    await db.execute(
      `INSERT INTO companies (company_id, name, status, workspace_root, default_model_policy_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['company-001', 'AICS Demo Company', 'active', null, null, now, now],
    );

    const employees = [
      {
        id: 'emp-alice',
        name: 'Alice',
        role: 'engineering_manager',
        persona: JSON.stringify({ expertise: 'engineering management', style: 'collaborative' }),
      },
      {
        id: 'emp-bob',
        name: 'Bob',
        role: 'developer',
        persona: JSON.stringify({ expertise: 'full-stack development', style: 'detail-oriented' }),
      },
      {
        id: 'emp-carol',
        name: 'Carol',
        role: 'designer',
        persona: JSON.stringify({ expertise: 'UI/UX design', style: 'creative' }),
      },
    ];

    for (const emp of employees) {
      await db.execute(
        `INSERT INTO employees
         (employee_id, company_id, source_asset_id, source_package_id, name, role_slug,
          workstation_id, persona_json, config_json, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          emp.id,
          'company-001',
          null,
          null,
          emp.name,
          emp.role,
          null,
          emp.persona,
          null,
          1,
          now,
          now,
        ],
      );
    }

    await db.execute('COMMIT');
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
}
