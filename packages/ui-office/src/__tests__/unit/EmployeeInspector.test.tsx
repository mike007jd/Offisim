import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeInspector } from '../../components/agents/EmployeeInspector';

describe('EmployeeInspector', () => {
  it('uses the provided left offset so it stays aligned with the sidebar', () => {
    render(
      <EmployeeInspector
        employeeId="emp-1"
        leftOffset={44}
        agents={
          new Map([
            [
              'emp-1',
              {
                id: 'emp-1',
                empId: 'emp-1',
                name: 'Avery Stone',
                role: 'developer',
                state: 'idle',
                taskRunId: null,
                workstationId: null,
                subTasks: [],
              },
            ],
          ])
        }
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('employee-inspector')).toHaveStyle({ left: '44px' });
  });
});
