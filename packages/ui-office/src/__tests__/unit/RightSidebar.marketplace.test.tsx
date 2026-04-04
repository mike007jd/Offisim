import { render, screen } from '@testing-library/react';
import { RightSidebar } from '../../components/layout/RightSidebar.js';

vi.mock('../../runtime/use-agent-states', () => ({
  useAgentStates: () => [],
}));

vi.mock('../../components/events/EventLog', () => ({
  EventLog: () => <div>events-panel</div>,
}));

vi.mock('../../components/library/Library', () => ({
  Library: () => <div>library-panel</div>,
}));

vi.mock('../../components/pitch/PitchHall', () => ({
  PitchHall: () => <div>outputs-panel</div>,
}));

vi.mock('../../components/plan/TaskDashboard', () => ({
  TaskDashboard: () => <div>tasks-panel</div>,
}));

vi.mock('../../components/server-room/ServerRoom', () => ({
  ServerRoom: () => <div>server-panel</div>,
}));

vi.mock('../../components/sop/SopPanel', () => ({
  SopPanel: () => <div>sops-panel</div>,
}));

describe('RightSidebar marketplace integration', () => {
  it('renders the marketplace tab alongside the existing operations tabs', () => {
    render(
      <RightSidebar
        onOpenMarketplaceListing={vi.fn()}
        onStartMarketplaceInstall={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Market')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });
});
