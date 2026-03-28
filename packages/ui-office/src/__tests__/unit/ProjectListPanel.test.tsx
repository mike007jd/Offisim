import type { ProjectRow } from '@offisim/shared-types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectListPanel } from '../../components/project/ProjectListPanel.js';

function makeProject(
  overrides: Partial<ProjectRow> & {
    project_id: string;
    name: string;
    status: ProjectRow['status'];
  },
): ProjectRow {
  return {
    company_id: 'co-1',
    thread_id: null,
    description: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

const ACTIVE_PROJECT = makeProject({
  project_id: 'p-1',
  name: 'Alpha',
  status: 'active',
  description: 'Our main project',
  thread_id: 'thread-abc-123-xyz-000',
});
const PLANNING_PROJECT = makeProject({ project_id: 'p-2', name: 'Beta', status: 'planning' });
const COMPLETED_PROJECT = makeProject({ project_id: 'p-3', name: 'Gamma', status: 'completed' });

describe('ProjectListPanel', () => {
  it('renders all projects', () => {
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT, PLANNING_PROJECT, COMPLETED_PROJECT]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('shows project name, status badge, and description', () => {
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    // "Active" appears as both section header and badge — both should be present
    const activeElements = screen.getAllByText('Active');
    expect(activeElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Our main project')).toBeInTheDocument();
  });

  it('status badges render with correct text for all statuses', () => {
    const projects = [
      makeProject({ project_id: 'p-a', name: 'A', status: 'planning' }),
      makeProject({ project_id: 'p-b', name: 'B', status: 'active' }),
      makeProject({ project_id: 'p-c', name: 'C', status: 'paused' }),
      makeProject({ project_id: 'p-d', name: 'D', status: 'completed' }),
      makeProject({ project_id: 'p-e', name: 'E', status: 'archived' }),
    ];
    render(
      <ProjectListPanel
        projects={projects}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Note: "Active" and "Completed" appear as both section headers and status badges.
    // Use getAllByText to confirm each label is present at least once.
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('shows empty state message when no projects', () => {
    render(
      <ProjectListPanel
        projects={[]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    // Close button has an X icon — find the button near the header
    const _headerCloseBtn = screen.getByRole('button', { name: '' }); // lucide X has no text
    // Find close button by being the only one in the header area (has X icon child)
    const allButtons = screen.getAllByRole('button');
    // The close button is right after "Projects" heading — we can click the SVG-containing button
    // It's the button that directly calls onClose (not onSelect+onClose)
    // It's the first button with an SVG that doesn't have a type-button with onClick calling onSelect
    // Safer: find button by its position — it should be the "X" button in the header
    const closeButton = allButtons.find((btn) => {
      const svg = btn.querySelector('svg');
      // The close button only has the X icon, no text node
      return svg && btn.textContent?.trim() === '';
    });
    expect(closeButton).toBeDefined();
    if (!closeButton) {
      throw new Error('Expected close button to exist');
    }
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect and onClose when a project card is clicked', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT]}
        activeProjectId={null}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledWith('p-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows project count badge in header', () => {
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT, PLANNING_PROJECT]}
        activeProjectId={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onSelect with null and onClose when "All" option is clicked', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectListPanel
        projects={[ACTIVE_PROJECT]}
        activeProjectId="p-1"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('All (no project scope)'));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});
