import { describe, expect, it } from 'vitest';
import { SP } from '../../components/studio/studio-tokens';

describe('studio spacing tokens', () => {
  it('reads spacing values from CSS variables', () => {
    document.documentElement.style.setProperty('--sp-xs', '6px');
    document.documentElement.style.setProperty('--sp-md', '14px');

    expect(SP.xs).toBe(6);
    expect(SP.md).toBe(14);
  });
});
