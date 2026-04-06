import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeInspector } from '../../components/agents/EmployeeInspector';

describe('EmployeeInspector', () => {
  it('shows task focus, subtask progress, and action labels', () => {
    const onClose = vi.fn();
    const onOpenEditor = vi.fn();
    const onStartChat = vi.fn();
    const agents = new Map([
      [
        'emp-1',
        {
          name: 'Avery',
          role: 'developer',
          state: 'executing',
          taskRunId: 'task-run-123456789',
          workstationId: 'desk-4',
          currentTask: {
            stepLabel: 'Patch the event feed',
            stepIndex: 1,
            totalSteps: 4,
          },
          subTasks: [
            { stepIndex: 0, label: 'Inspect activity feed', status: 'done' as const },
            { stepIndex: 1, label: 'Rewrite runtime copy', status: 'running' as const },
          ],
        },
      ],
    ]);

    render(
      <EmployeeInspector
        employeeId="emp-1"
        agents={agents}
        onClose={onClose}
        onOpenEditor={onOpenEditor}
        onStartChat={onStartChat}
      />,
    );

    expect(screen.getByText('Patch the event feed')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('1/2 complete')).toBeInTheDocument();
    expect(screen.getByText('In progress: Rewrite runtime copy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByText('Quick Inspect')).toBeInTheDocument();
    expect(screen.queryByText('Employee Profile')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open details' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));

    expect(onStartChat).toHaveBeenCalledWith('emp-1');
    expect(onOpenEditor).toHaveBeenCalledWith('emp-1');
  });
});
