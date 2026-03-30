import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @tauri-apps/plugin-sql
const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb = { select: mockSelect, execute: mockExecute };

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn().mockResolvedValue(mockDb) },
}));

describe('createTauriDrizzleDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Drizzle DB instance with expected API', async () => {
    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
  });
});

describe('convertPlaceholders (via proxy callback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue([]);
    mockExecute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 0 });
  });

  it('converts ? placeholders to $N in SELECT queries', async () => {
    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();

    // Trigger a SELECT through Drizzle — this will invoke our proxy callback
    // which should convert ? to $1, $2, etc.
    const { employees } = await import('@offisim/db-local');
    const { eq } = await import('drizzle-orm');

    mockSelect.mockResolvedValue([{ employee_id: 'emp-alice', name: 'Alice' }]);

    await db.select().from(employees).where(eq(employees.employee_id, 'emp-alice'));

    // Verify the SQL sent to plugin-sql uses $N format
    expect(mockSelect).toHaveBeenCalledOnce();
    const [sql, params] = mockSelect.mock.calls[0] ?? [];
    expect(sql).toContain('$1');
    expect(sql).not.toContain('?');
    expect(params).toEqual(['emp-alice']);
  });

  it('converts multiple ? placeholders correctly', async () => {
    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();

    const { employees } = await import('@offisim/db-local');
    const { eq, and } = await import('drizzle-orm');

    mockSelect.mockResolvedValue([]);

    await db
      .select()
      .from(employees)
      .where(and(eq(employees.company_id, 'company-001'), eq(employees.role_slug, 'developer')));

    expect(mockSelect).toHaveBeenCalledOnce();
    const [sql, params] = mockSelect.mock.calls[0] ?? [];
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).not.toContain('?');
    expect(params).toEqual(['company-001', 'developer']);
  });

  it('uses execute for INSERT (run method)', async () => {
    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();

    const { companies } = await import('@offisim/db-local');

    mockExecute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 });

    const now = new Date().toISOString();
    await db.insert(companies).values({
      company_id: 'test-co',
      name: 'Test',
      status: 'active',
      template_id: null,
      template_label: null,
      created_at: now,
      updated_at: now,
    });

    expect(mockExecute).toHaveBeenCalled();
    const [sql] = mockExecute.mock.calls[0] ?? [];
    expect(sql).toContain('$1');
    expect(sql).not.toContain('?');
  });
});
