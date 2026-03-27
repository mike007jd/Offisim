import { describe, expect, it } from 'vitest';
import { shouldAnimateOfficeScene } from '../../components/scene/scene-render-policy';

describe('shouldAnimateOfficeScene', () => {
  it('returns false when the office is completely idle', () => {
    expect(
      shouldAnimateOfficeScene({
        activeCount: 0,
        blockedCount: 0,
        isDragging: false,
        flowLineCount: 0,
        ceremonyPhase: 'idle',
      }),
    ).toBe(false);
  });

  it('returns true when runtime activity is visible', () => {
    expect(
      shouldAnimateOfficeScene({
        activeCount: 1,
        blockedCount: 0,
        isDragging: false,
        flowLineCount: 0,
        ceremonyPhase: 'working',
      }),
    ).toBe(true);
  });

  it('returns true for drag interactions and transient effects', () => {
    expect(
      shouldAnimateOfficeScene({
        activeCount: 0,
        blockedCount: 0,
        isDragging: true,
        flowLineCount: 0,
        ceremonyPhase: 'idle',
      }),
    ).toBe(true);

    expect(
      shouldAnimateOfficeScene({
        activeCount: 0,
        blockedCount: 0,
        isDragging: false,
        flowLineCount: 1,
        ceremonyPhase: 'idle',
      }),
    ).toBe(true);
  });
});
