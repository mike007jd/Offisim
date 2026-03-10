import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb = { select: mockSelect, execute: mockExecute };

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn().mockResolvedValue(mockDb) },
}));

describe('TauriCheckpointSaver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 });
  });

  it('getTuple returns undefined for missing checkpoint', async () => {
    mockSelect.mockResolvedValue([]);

    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    const result = await saver.getTuple({
      configurable: { thread_id: 'test-thread', checkpoint_ns: '' },
    });

    expect(result).toBeUndefined();
    expect(mockSelect).toHaveBeenCalledOnce();
  });

  it('put stores checkpoint via execute', async () => {
    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    const config = {
      configurable: { thread_id: 'test-thread', checkpoint_ns: '', checkpoint_id: 'cp-parent' },
    };
    const checkpoint = {
      v: 4,
      id: 'cp-new',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };

    // biome-ignore lint/suspicious/noExplicitAny: partial checkpoint test double
    const result = await saver.put(config, checkpoint as any, {
      source: 'input',
      step: 0,
      parents: {},
    });

    expect(result.configurable?.checkpoint_id).toBe('cp-new');
    // Verify INSERT OR REPLACE was called
    expect(mockExecute).toHaveBeenCalled();
    const call = mockExecute.mock.calls.find(
      // biome-ignore lint/suspicious/noExplicitAny: mock call args inspection
      (c: any) => typeof c[0] === 'string' && c[0].includes('INSERT OR REPLACE INTO checkpoints'),
    );
    expect(call).toBeDefined();
  });

  it('putWrites stores writes in a transaction', async () => {
    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    const config = {
      configurable: { thread_id: 'test-thread', checkpoint_ns: '', checkpoint_id: 'cp-1' },
    };

    await saver.putWrites(config, [['messages', { role: 'user', content: 'hello' }]], 'task-1');

    // Expect BEGIN, INSERT, COMMIT
    // biome-ignore lint/suspicious/noExplicitAny: mock call args inspection
    const sqls = mockExecute.mock.calls.map((c: any) => c[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s: string) => s.includes('INSERT OR REPLACE INTO writes'))).toBe(true);
  });

  it('deleteThread removes checkpoints and writes', async () => {
    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    await saver.deleteThread('test-thread');

    // Expect BEGIN, 2x DELETE, COMMIT
    expect(mockExecute).toHaveBeenCalledTimes(4);
    // biome-ignore lint/suspicious/noExplicitAny: mock call args inspection
    const sqls = mockExecute.mock.calls.map((c: any) => c[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s: string) => s.includes('DELETE FROM checkpoints'))).toBe(true);
    expect(sqls.some((s: string) => s.includes('DELETE FROM writes'))).toBe(true);
  });
});
