import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeCreatorOverlay } from '../../components/employees/EmployeeCreatorOverlay';

describe('EmployeeCreatorOverlay', () => {
  it('uses employee-first wording in the primary UI copy', () => {
    render(<EmployeeCreatorOverlay open onClose={vi.fn()} onDeploy={vi.fn()} />);

    expect(screen.getByText('EMPLOYEE_DEPLOYMENT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add employee/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Back')).toBeInTheDocument();
    expect(screen.queryByText('ATTRIBUTES')).toBeNull();
    expect(screen.getByText('Role Defaults')).toBeInTheDocument();
  });

  it('closes on Escape when open', () => {
    const onClose = vi.fn();

    render(<EmployeeCreatorOverlay open onClose={onClose} onDeploy={vi.fn()} />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
