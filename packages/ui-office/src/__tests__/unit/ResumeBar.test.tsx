import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResumeBar } from '../../components/project/ResumeBar.js';

const PROJECTS = [
  { threadId: 'thread-1', projectName: 'Alpha Project' },
  { threadId: 'thread-2', projectName: 'Beta Project' },
];

describe('ResumeBar', () => {
  it('returns null when projects array is empty', () => {
    const { container } = render(
      <ResumeBar projects={[]} onResume={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows count "1 unfinished project" for a single project', () => {
    render(<ResumeBar projects={[PROJECTS[0]]} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('1 unfinished project')).toBeInTheDocument();
  });

  it('shows count "2 unfinished projects" for multiple projects', () => {
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('2 unfinished projects')).toBeInTheDocument();
  });

  it('renders a resume button per project with project name', () => {
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Resume Alpha Project')).toBeInTheDocument();
    expect(screen.getByText('Resume Beta Project')).toBeInTheDocument();
  });

  it('calls onResume with correct threadId when resume button is clicked', async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={onResume} onDismiss={vi.fn()} />);
    await user.click(screen.getByText('Resume Alpha Project'));
    expect(onResume).toHaveBeenCalledWith('thread-1');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('calls onResume with the second thread when second button is clicked', async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={onResume} onDismiss={vi.fn()} />);
    await user.click(screen.getByText('Resume Beta Project'));
    expect(onResume).toHaveBeenCalledWith('thread-2');
  });

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByLabelText('Dismiss unfinished project notice'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows dismiss button text', () => {
    render(<ResumeBar projects={[PROJECTS[0]]} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });
});
