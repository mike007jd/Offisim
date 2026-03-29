import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateMock, useThreeMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  useThreeMock: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
  useThree: useThreeMock,
}));

import {
  SceneFrameLoopController,
  type OrbitControlsHandleLike,
} from '../../components/scene/SceneFrameLoopController';

describe('SceneFrameLoopController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThreeMock.mockReturnValue({ invalidate: invalidateMock });
  });

  it('does not start a manual animation frame loop when scene animation is enabled', () => {
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame');
    const controlsRef = {
      current: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } satisfies OrbitControlsHandleLike,
    };

    render(<SceneFrameLoopController animate controlsRef={controlsRef} />);

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
  });

  it('invalidates on orbit controls changes', () => {
    let onChange: (() => void) | undefined;
    const controlsRef = {
      current: {
        addEventListener: vi.fn((event, handler) => {
          if (event === 'change') onChange = handler;
        }),
        removeEventListener: vi.fn(),
      } satisfies OrbitControlsHandleLike,
    };

    render(<SceneFrameLoopController animate={false} controlsRef={controlsRef} />);

    onChange?.();

    expect(controlsRef.current.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(invalidateMock).toHaveBeenCalledTimes(2);
  });
});
