import { fireEvent, render, screen } from '@testing-library/react';
import { useStudioStore } from '../../components/studio/StudioState.js';
import { StudioToolbar } from '../../components/studio/StudioToolbar.js';

describe('StudioToolbar', () => {
  beforeEach(() => {
    useStudioStore.setState({
      companyId: 'co-1',
      tool: 'select',
      plotSize: { name: 'Standard Office', width: 40, depth: 30 },
      placingPrefab: null,
      ghostRotation: 0,
      selectedInstanceId: null,
      instances: [],
      zones: [
        {
          zoneId: 'zone-1',
          label: 'Rest Area',
          accentColor: '#f59e0b',
          cx: 0,
          cz: 0,
          w: 8,
          d: 8,
        } as never,
      ],
      focusedZoneId: null,
      selectedZoneId: 'zone-1',
      isEditingZone: false,
      placingZonePreset: null,
      dirty: false,
      gridSnap: true,
    });
  });

  it('uses an explicit Edit Zone action instead of relying on a double-click gesture', () => {
    render(<StudioToolbar onSave={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter zone editing mode' }));

    expect(useStudioStore.getState().isEditingZone).toBe(true);
    expect(useStudioStore.getState().focusedZoneId).toBe('zone-1');
  });
});
