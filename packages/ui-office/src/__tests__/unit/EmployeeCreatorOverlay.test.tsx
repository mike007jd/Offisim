import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeCreatorOverlay } from '../../components/employees/EmployeeCreatorOverlay';

describe('EmployeeCreatorOverlay', () => {
  it('closes on Escape when open', () => {
    const onClose = vi.fn();

    render(<EmployeeCreatorOverlay open onClose={onClose} onDeploy={vi.fn()} />);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
