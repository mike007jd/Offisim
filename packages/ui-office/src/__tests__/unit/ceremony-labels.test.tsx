import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Office3DSceneHud } from '../../components/scene/office3d-sections';
import { CEREMONY_LABELS } from '../../lib/ceremony-labels';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('CEREMONY_LABELS', () => {
  it('covers every ceremony phase with a readable label or null idle state', () => {
    expect(CEREMONY_LABELS).toEqual({
      idle: null,
      gathering: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
      analyzing: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
      planning: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
      dispatching: expect.objectContaining({
        label: expect.any(String),
        color: expect.any(String),
      }),
      working: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
      reporting: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
      dismissing: expect.objectContaining({ label: expect.any(String), color: expect.any(String) }),
    });
  });

  it('renders the active ceremony phase in the scene HUD', () => {
    render(<Office3DSceneHud activeCount={3} blockedCount={1} ceremonyPhase="working" />);

    expect(screen.getByText('Employees working')).toBeInTheDocument();
    expect(screen.getByText('3 active')).toBeInTheDocument();
    expect(screen.getByText('1 blocked')).toBeInTheDocument();
  });

  it('hides ceremony phase details while idle', () => {
    render(<Office3DSceneHud activeCount={0} blockedCount={0} ceremonyPhase="idle" />);

    expect(screen.queryByText('Employees working')).toBeNull();
    expect(screen.getByText('0 active')).toBeInTheDocument();
  });
});
