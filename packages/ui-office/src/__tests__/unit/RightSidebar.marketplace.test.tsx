import { render, screen } from '@testing-library/react';
import { RightSidebar } from '../../components/layout/RightSidebar.js';

vi.mock('../../runtime/use-agent-states', () => ({
  useAgentStates: () => [],
}));

vi.mock('../../components/pitch/PitchHall', () => ({
  PitchHall: () => <div>outputs-panel</div>,
}));

vi.mock('../../components/plan/TaskDashboard', () => ({
  TaskDashboard: () => <div>tasks-panel</div>,
}));

describe('RightSidebar collaboration tabs', () => {
  it('keeps only collaboration-oriented tabs in the right panel', () => {
    render(<RightSidebar />);

    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Results' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'SOPs' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Market' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Events' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
