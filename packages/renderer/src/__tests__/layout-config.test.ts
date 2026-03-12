import { describe, expect, it } from 'vitest';
import { LAYOUT_PRESETS, getPreset } from '../types/layout-config.js';

describe('LayoutConfig', () => {
  it('has 3 presets', () => {
    expect(Object.keys(LAYOUT_PRESETS)).toHaveLength(3);
  });

  it('2x2 preset has 4 workstations', () => {
    const preset = LAYOUT_PRESETS['2x2']!;
    expect(preset.workstations).toHaveLength(4);
    expect(preset.gridCols).toBe(2);
    expect(preset.gridRows).toBe(2);
  });

  it('2x3 preset has 6 workstations', () => {
    const preset = LAYOUT_PRESETS['2x3']!;
    expect(preset.workstations).toHaveLength(6);
  });

  it('3x3 preset has 9 workstations with mixed room types', () => {
    const preset = LAYOUT_PRESETS['3x3']!;
    expect(preset.workstations).toHaveLength(9);
    const types = preset.workstations.map((w) => w.roomType);
    expect(types).toContain('meeting');
    expect(types).toContain('server_room');
    expect(types).toContain('library');
  });

  it('getPreset returns 2x2 for unknown name', () => {
    const preset = getPreset('nonexistent');
    expect(preset.workstations).toHaveLength(4);
  });

  it('all workstations have unique IDs within preset', () => {
    for (const [, preset] of Object.entries(LAYOUT_PRESETS)) {
      const ids = preset.workstations.map((w) => w.workstationId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
