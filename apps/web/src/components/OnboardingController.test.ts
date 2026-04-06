import { describe, expect, it } from 'vitest';
import { computeHintPosition } from './OnboardingController';

describe('computeHintPosition', () => {
  it('falls back to a centered bottom position when no target is available', () => {
    expect(computeHintPosition(null, { width: 1280, height: 800 })).toEqual({
      left: '50%',
      bottom: 24,
      transform: 'translateX(-50%)',
    });
  });

  it('keeps the hint inside the viewport when the target sits below the visible area', () => {
    const position = computeHintPosition(
      {
        top: 860,
        left: 420,
        width: 280,
        height: 0,
      },
      { width: 1280, height: 800 },
    );

    expect(position).toMatchObject({
      left: 400,
      top: 628,
      width: 320,
    });
  });

  it('pins the hint below the target when there is space and clamps horizontally', () => {
    const position = computeHintPosition(
      {
        top: 80,
        left: 1180,
        width: 160,
        height: 32,
      },
      { width: 1280, height: 800 },
    );

    expect(position).toMatchObject({
      left: 952,
      top: 124,
      width: 320,
    });
  });
});
