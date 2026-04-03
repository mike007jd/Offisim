import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useSceneCeremonyMock = vi.fn();

vi.mock('../../runtime/scene-ceremony-context.js', () => ({
  useSceneCeremony: () => useSceneCeremonyMock(),
}));

import { PipelineProgress } from '../../components/chat/PipelineProgress.js';

describe('PipelineProgress', () => {
  it('shows the active ceremony subtitle for working-phase execution', () => {
    useSceneCeremonyMock.mockReturnValue({
      phase: 'working',
      bubbleText: '',
      participantIds: new Set(),
      dispatchedIds: new Set(),
      managerVisible: false,
      managerPosition: null,
      waitingRelationships: [],
    });

    render(<PipelineProgress stage="executing" isRunning />);

    expect(screen.getByText('Employees working')).toBeInTheDocument();
  });

  it('renders the ceremony subtitle without hard-coded left padding', () => {
    useSceneCeremonyMock.mockReturnValue({
      phase: 'dispatching',
      bubbleText: '',
      participantIds: new Set(),
      dispatchedIds: new Set(),
      managerVisible: false,
      managerPosition: null,
      waitingRelationships: [],
    });

    render(<PipelineProgress stage="dispatching" isRunning />);

    expect(screen.getByText('Dispatching tasks').parentElement).not.toHaveClass('pl-[11.75rem]');
  });
});
