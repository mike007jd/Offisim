import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeMarker } from '../../components/scene/office3d-employees';
import type { PlacedEmployee } from '../../components/scene/office3d-employees';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../hooks/useAgentAnimation.js', () => ({
  useAgentAnimation: vi.fn(),
}));

vi.mock('../../hooks/useCharacterMovement.js', () => ({
  useCharacterMovement: () => ({ moveTo: vi.fn(), stop: vi.fn() }),
}));

vi.mock('../../hooks/useSceneOrchestrator.js', () => ({
  registerMovementHandle: vi.fn(),
  unregisterMovementHandle: vi.fn(),
}));

vi.mock('../../theme/use-scene-colors.js', () => ({
  useSceneColors: () => ({
    selectionRing: '#60a5fa',
    textMuted: '#94a3b8',
  }),
}));

vi.mock('../../components/company/CompanyContext.js', () => ({
  useCompany: () => ({
    activeCompanyId: 'co-1',
  }),
}));

function makeEmployee(overrides?: Partial<PlacedEmployee>): PlacedEmployee {
  return {
    id: 'emp-1',
    globalIndex: 0,
    position: [0, 0, 0],
    agent: {
      name: 'Alice',
      role: 'developer',
      state: 'executing',
    },
    ...overrides,
  };
}

describe('EmployeeMarker', () => {
  it('shows a selected employee name pill', () => {
    render(<EmployeeMarker emp={makeEmployee()} isSelected onSelect={vi.fn()} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('does not render the selected name pill when the employee is not selected', () => {
    render(<EmployeeMarker emp={makeEmployee()} isSelected={false} onSelect={vi.fn()} />);

    expect(screen.queryByText('Alice')).toBeNull();
  });
});
