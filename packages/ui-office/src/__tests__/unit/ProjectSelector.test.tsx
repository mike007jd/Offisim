import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectRow } from '@aics/shared-types';
import { ProjectSelector } from '../../components/project/ProjectSelector.js';

function makeProject(overrides: Partial<ProjectRow> & { project_id: string; name: string; status: ProjectRow['status'] }): ProjectRow {
  return {
    company_id: 'co-1',
    thread_id: null,
    description: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

const ACTIVE = makeProject({ project_id: 'p-1', name: 'Alpha', status: 'active' });
const PLANNING = makeProject({ project_id: 'p-2', name: 'Beta', status: 'planning' });
const PAUSED = makeProject({ project_id: 'p-3', name: 'Gamma', status: 'paused' });
const COMPLETED = makeProject({ project_id: 'p-4', name: 'Delta', status: 'completed' });
const ARCHIVED = makeProject({ project_id: 'p-5', name: 'Epsilon', status: 'archived' });

describe('ProjectSelector', () => {
  it('renders "All" when no project is selected', () => {
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders the active project name in the trigger when one is selected', () => {
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId="p-1" onSelect={vi.fn()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('opens dropdown when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId={null} onSelect={vi.fn()} />);
    // Dropdown is hidden initially
    expect(screen.queryByText('Projects')).toBeNull();
    await user.click(screen.getByTitle('Select project context'));
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('lists all provided active projects in the dropdown', async () => {
    const user = userEvent.setup();
    render(
      <ProjectSelector
        projects={[ACTIVE, PLANNING, PAUSED]}
        activeProjectId={null}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByTitle('Select project context'));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('calls onSelect with projectId when a project button is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId={null} onSelect={onSelect} />);
    await user.click(screen.getByTitle('Select project context'));
    await user.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledWith('p-1');
  });

  it('calls onSelect with null when "All" is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId="p-1" onSelect={onSelect} />);
    await user.click(screen.getByTitle('Select project context'));
    // The "All" option inside the dropdown
    const allButtons = screen.getAllByText('All');
    // Click the dropdown All button (there may be two — trigger 'All' only shows when activeProjectId=null)
    await user.click(allButtons[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows "No projects yet" when projects array is empty', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector projects={[]} activeProjectId={null} onSelect={vi.fn()} />);
    await user.click(screen.getByTitle('Select project context'));
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });

  it('groups completed/archived projects under "Completed" section', async () => {
    const user = userEvent.setup();
    render(
      <ProjectSelector
        projects={[ACTIVE, COMPLETED, ARCHIVED]}
        activeProjectId={null}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByTitle('Select project context'));
    // "Completed" appears as both the section header and as the status label next to the project
    const completedEls = screen.getAllByText('Completed');
    expect(completedEls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Delta')).toBeInTheDocument();
    expect(screen.getByText('Epsilon')).toBeInTheDocument();
  });

  it('status dots have correct color classes', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProjectSelector
        projects={[ACTIVE, PLANNING, PAUSED]}
        activeProjectId={null}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByTitle('Select project context'));
    const dots = container.querySelectorAll('.rounded-full');
    const dotClasses = Array.from(dots).map((d) => d.className);
    // active → emerald, planning → blue, paused → amber
    expect(dotClasses.some((c) => c.includes('bg-emerald-400'))).toBe(true);
    expect(dotClasses.some((c) => c.includes('bg-blue-400'))).toBe(true);
    expect(dotClasses.some((c) => c.includes('bg-amber-400'))).toBe(true);
  });

  it('closes dropdown on outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ProjectSelector projects={[ACTIVE]} activeProjectId={null} onSelect={vi.fn()} />
        <button type="button">Outside</button>
      </div>,
    );
    await user.click(screen.getByTitle('Select project context'));
    expect(screen.getByText('Projects')).toBeInTheDocument();
    await user.click(screen.getByText('Outside'));
    expect(screen.queryByText('Projects')).toBeNull();
  });

  it('closes dropdown by clicking the trigger button again (toggle)', async () => {
    const user = userEvent.setup();
    render(<ProjectSelector projects={[ACTIVE]} activeProjectId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByTitle('Select project context');
    await user.click(trigger); // open
    expect(screen.getByText('Projects')).toBeInTheDocument();
    await user.click(trigger); // close via toggle
    expect(screen.queryByText('Projects')).toBeNull();
  });
});
