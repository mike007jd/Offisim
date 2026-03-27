import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { office3DMounts, office3DUnmounts, useSceneMock } = vi.hoisted(() => ({
  office3DMounts: vi.fn(),
  office3DUnmounts: vi.fn(),
  useSceneMock: vi.fn(),
}));

vi.mock('../../components/scene/useScene', () => ({
  useScene: useSceneMock,
}));

vi.mock('../../components/scene/PerformanceHUD', () => ({
  PerformanceHUD: () => <div data-testid="perf-hud" />,
}));

vi.mock('../../components/scene/Office2DView', () => ({
  default: function MockOffice2DView() {
    return <div data-testid="office-2d-view">2D office</div>;
  },
}));

vi.mock('../../components/scene/Office3DView', () => ({
  default: function MockOffice3DView({ active }: { active?: boolean }) {
    useEffect(() => {
      office3DMounts();
      return () => {
        office3DUnmounts();
      };
    }, []);

    return (
      <div data-active={String(active)} data-testid="office-3d-view">
        3D office
      </div>
    );
  },
}));

import { SceneCanvas } from '../../components/scene/SceneCanvas';

describe('SceneCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the 3D canvas mounted when switching to 2D mode', async () => {
    const view = render(<SceneCanvas active viewMode="3D" />);

    expect(await screen.findByTestId('office-3d-view')).toHaveAttribute('data-active', 'true');
    expect(office3DMounts).toHaveBeenCalledTimes(1);

    view.rerender(<SceneCanvas active viewMode="2D" />);

    expect(await screen.findByTestId('office-2d-view')).toBeInTheDocument();
    expect(screen.getByTestId('office-3d-view')).toBeInTheDocument();
    expect(screen.getByTestId('office-3d-view')).toHaveAttribute('data-active', 'false');
    expect(office3DUnmounts).not.toHaveBeenCalled();
  });

  it('pauses the retained 3D scene when the office view is hidden behind an overlay', async () => {
    const view = render(<SceneCanvas active viewMode="3D" />);

    expect(await screen.findByTestId('office-3d-view')).toHaveAttribute('data-active', 'true');

    view.rerender(<SceneCanvas active={false} viewMode="3D" />);

    expect(screen.getByTestId('office-3d-view')).toHaveAttribute('data-active', 'false');
    expect(office3DUnmounts).not.toHaveBeenCalled();
  });
});
