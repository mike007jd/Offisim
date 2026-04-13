import { describe, expect, it } from 'vitest';
import { getAutoSmokeTemplate, isDevAutoSmokeEnabled } from './dev-auto-smoke';

describe('isDevAutoSmokeEnabled', () => {
  it('only enables auto smoke in dev tauri sessions with explicit flag', () => {
    expect(isDevAutoSmokeEnabled({ dev: true, tauri: true, flag: '1' })).toBe(true);
    expect(isDevAutoSmokeEnabled({ dev: true, tauri: true, flag: '0' })).toBe(false);
    expect(isDevAutoSmokeEnabled({ dev: true, tauri: false, flag: '1' })).toBe(false);
    expect(isDevAutoSmokeEnabled({ dev: false, tauri: true, flag: '1' })).toBe(false);
  });
});

describe('getAutoSmokeTemplate', () => {
  it('prefers the rd-company template when present', () => {
    expect(
      getAutoSmokeTemplate([
        { id: 'ai-startup', name: 'AI Startup' },
        { id: 'rd-company', name: 'R&D Company' },
      ]),
    ).toEqual({ id: 'rd-company', name: 'R&D Company' });
  });

  it('falls back to the first template when rd-company is absent', () => {
    expect(
      getAutoSmokeTemplate([
        { id: 'ai-startup', name: 'AI Startup' },
        { id: 'product-team', name: 'Product Team' },
      ]),
    ).toEqual({ id: 'ai-startup', name: 'AI Startup' });
  });

  it('returns null when no templates exist', () => {
    expect(getAutoSmokeTemplate([])).toBeNull();
  });
});
