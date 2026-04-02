import { describe, expect, it, vi } from 'vitest';
import { Scratchpad } from '../../runtime/scratchpad.js';

describe('Scratchpad', () => {
  it('writes and reads entries by key', () => {
    const scratchpad = new Scratchpad();

    scratchpad.write('pm.plan.thread-1', 'Break work into research and delivery.', 'pm_planner');

    expect(scratchpad.read('pm.plan.thread-1')).toBe('Break work into research and delivery.');
  });

  it('lists entries in reverse chronological order with summaries', () => {
    const scratchpad = new Scratchpad();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    scratchpad.write('older', 'Older note', 'manager');
    scratchpad.write('newer', 'Newer note', 'employee');

    expect(scratchpad.list()).toEqual([
      { key: 'newer', summary: 'Newer note', author: 'employee' },
      { key: 'older', summary: 'Older note', author: 'manager' },
    ]);
    nowSpy.mockRestore();
  });

  it('clears all entries', () => {
    const scratchpad = new Scratchpad();

    scratchpad.write('key', 'content', 'manager');
    scratchpad.clear();

    expect(scratchpad.read('key')).toBeNull();
    expect(scratchpad.list()).toEqual([]);
  });
});
