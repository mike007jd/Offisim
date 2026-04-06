import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudioToolbar } from '../../components/studio/StudioToolbar.js';

vi.mock('../../components/studio/StudioState.js', () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      tool: 'select',
      setTool: vi.fn(),
      gridSnap: true,
      toggleGridSnap: vi.fn(),
      dirty: false,
      instances: [],
      selectedZoneId: null,
      isEditingZone: false,
      enterEditZone: vi.fn(),
      exitEditZone: vi.fn(),
      focusedZoneId: null,
      zones: [],
    }),
}));

describe('StudioToolbar', () => {
  it('uses office editing language for the back action', () => {
    render(<StudioToolbar onSave={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Back to office' })).toBeInTheDocument();
  });

  it('calls onBack when the back action is pressed', () => {
    const onBack = vi.fn();

    render(<StudioToolbar onSave={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to office' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
