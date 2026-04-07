import { render, screen } from '@testing-library/react';
import { RightSidebar } from '../../components/layout/RightSidebar.js';

vi.mock('../../runtime/use-agent-states', () => ({
  useAgentStates: () => new Map(),
}));

vi.mock('../../hooks/usePipelineStage', () => ({
  usePipelineStage: () => null,
  STAGE_META: {},
}));

vi.mock('../../runtime/offisim-runtime-context', () => ({
  useOffisimRuntimeStatus: () => ({ isRunning: false }),
  useOffisimRuntime: () => ({
    eventBus: {
      on: () => () => {},
      emit: () => {},
    },
  }),
}));

vi.mock('../../components/pitch/PitchHall', () => ({
  PitchHall: () => <div>outputs-panel</div>,
}));

vi.mock('../../components/plan/TaskDashboard', () => ({
  TaskDashboard: () => <div>tasks-panel</div>,
}));

describe('RightSidebar', () => {
  it('keeps the right rail focused on collaboration only', () => {
    render(<RightSidebar chatPanel={<div>chat-panel</div>} />);

    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    expect(screen.queryByRole('tab', { name: 'SOPs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Market' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Outputs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Library' })).not.toBeInTheDocument();
  });

  it('shows the Collaboration label and workflow status', () => {
    render(<RightSidebar chatPanel={<div>chat-panel</div>} />);

    expect(screen.getByText('Collaboration')).toBeInTheDocument();
    expect(screen.getByText(/Idle\. Collaboration happens here\./)).toBeInTheDocument();
  });

  it('shows outputs inside the tasks context instead of as a top-level destination', () => {
    render(<RightSidebar chatPanel={<div>chat-panel</div>} focusTasksToken={1} />);

    expect(screen.getByText('tasks-panel')).toBeInTheDocument();
    expect(screen.getByText('outputs-panel')).toBeInTheDocument();
  });

  it('shows Deliverables section inside the tasks tab', () => {
    render(<RightSidebar chatPanel={<div>chat-panel</div>} focusTasksToken={1} />);

    expect(screen.getByText('Deliverables')).toBeInTheDocument();
  });

  it('returns to chat when a direct-chat request token changes', () => {
    const { rerender } = render(<RightSidebar chatPanel={<div>chat-panel</div>} focusTasksToken={1} />);

    expect(screen.queryByText('chat-panel')).not.toBeInTheDocument();

    rerender(
      <RightSidebar
        chatPanel={<div>chat-panel</div>}
        focusTasksToken={1}
        requestChatToken={1}
      />,
    );

    expect(screen.getByText('chat-panel')).toBeInTheDocument();
  });
});
