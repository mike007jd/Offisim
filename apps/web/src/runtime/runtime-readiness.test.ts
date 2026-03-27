import { describe, expect, it } from 'vitest';
import { isRuntimeReadyForInteraction } from './runtime-readiness';

describe('isRuntimeReadyForInteraction', () => {
  it('returns false for repos-only runtimes without orchestration', () => {
    expect(
      isRuntimeReadyForInteraction({
        orch: null,
      }),
    ).toBe(false);
  });

  it('returns true when orchestration is available', () => {
    expect(
      isRuntimeReadyForInteraction({
        orch: {},
      }),
    ).toBe(true);
  });
});
