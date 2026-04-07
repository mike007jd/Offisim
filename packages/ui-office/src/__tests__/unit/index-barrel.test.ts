import { describe, expect, it } from 'vitest';
import { SopPanel } from '../../index.js';

describe('ui-office barrel exports', () => {
  it('exports SopPanel for app consumers', () => {
    expect(SopPanel).toBeTypeOf('function');
  });
});
