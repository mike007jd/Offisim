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

  it('shows count "1 个项目未完成" for a single project', () => {
    render(<ResumeBar projects={[PROJECTS[0]]} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('1 个项目未完成')).toBeInTheDocument();
  });

  it('shows count "2 个项目未完成" for multiple projects', () => {
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('2 个项目未完成')).toBeInTheDocument();
  });

  it('renders a resume button per project with project name', () => {
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('恢复 Alpha Project')).toBeInTheDocument();
    expect(screen.getByText('恢复 Beta Project')).toBeInTheDocument();
  });

  it('calls onResume with correct threadId when resume button is clicked', async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={onResume} onDismiss={vi.fn()} />);
    await user.click(screen.getByText('恢复 Alpha Project'));
    expect(onResume).toHaveBeenCalledWith('thread-1');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('calls onResume with the second thread when second button is clicked', async () => {
    const onResume = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={onResume} onDismiss={vi.fn()} />);
    await user.click(screen.getByText('恢复 Beta Project'));
    expect(onResume).toHaveBeenCalledWith('thread-2');
  });

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<ResumeBar projects={PROJECTS} onResume={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByLabelText('忽略未完成项目提示'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows correct Chinese dismiss text', () => {
    render(<ResumeBar projects={[PROJECTS[0]]} onResume={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('忽略')).toBeInTheDocument();
  });
});
