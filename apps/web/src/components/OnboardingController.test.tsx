import { describe, expect, it } from 'vitest';
import { computeHintPosition } from './OnboardingController';

describe('computeHintPosition', () => {
  it('keeps the hint card inside the viewport when target is near the bottom-right edge', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });

    const style = computeHintPosition({
      top: 760,
      left: 1160,
      width: 24,
      height: 24,
    });

    expect(style.width).toBe(320);
    expect(style.left).toBeLessThanOrEqual(1200 - 320 - 8);
    expect(style.bottom).toBeLessThanOrEqual(800 - 8);
  });

  it('keeps the hint card inside the viewport when target is near the top edge', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 });

    const style = computeHintPosition({
      top: 4,
      left: 12,
      width: 40,
      height: 24,
    });

    expect(style.left).toBeGreaterThanOrEqual(8);
    expect(style.top).toBeGreaterThanOrEqual(8);
  });
});
