import { getTauriDb } from './tauri-db';

/**
 * Seed the Tauri SQLite database with default company + employees
 * on first launch. Checks if already seeded by looking for company-001.
 *
 * Wrapped in a transaction so partial failure doesn't leave dirty state.
 */
/**
 * Seed the Tauri SQLite database on first launch.
 *
 * Previously inserted a demo company + 3 mock employees.
 * Now a no-op — company creation is handled by the CompanyCreationWizard.
 * Kept as a function so callers don't break.
 */
export async function seedTauriDb(): Promise<void> {
  // No-op: companies and employees are created via the wizard / template system.
}
