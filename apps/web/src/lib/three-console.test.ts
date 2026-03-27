import { describe, expect, it } from 'vitest';
import { shouldSuppressThreeConsoleMessage } from './three-console';

describe('three console filter', () => {
  it('suppresses only the known Clock deprecation in development', () => {
    expect(
      shouldSuppressThreeConsoleMessage(
        'warn',
        'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
      ),
    ).toBe(true);
  });

  it('keeps unrelated warnings visible', () => {
    expect(
      shouldSuppressThreeConsoleMessage(
        'warn',
        'THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.',
      ),
    ).toBe(false);
    expect(
      shouldSuppressThreeConsoleMessage(
        'error',
        'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
      ),
    ).toBe(false);
  });
});
