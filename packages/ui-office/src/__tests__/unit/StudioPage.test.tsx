import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudioPage } from '../../components/studio/StudioPage.js';

const storeState = {
  dirty: false,
  focusedZoneId: null as string | null,
  isEditingZone: false,
  placingPrefab: null as { name: string } | null,
  placingZonePreset: null as { label: string } | null,
  zones: [] as Array<{ zoneId: string; label: string }>,
  resetForCompany: vi.fn(),
  loadZonesFromDb: vi.fn(),
  setInstances: vi.fn(),
};

vi.mock('../../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: () => ({ eventBus: { emit: vi.fn(), on: vi.fn().mockReturnValue(() => {}) } }),
}));

vi.mock('../../components/studio/StudioState.js', () => ({
  useStudioStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    {
      getState: () => storeState,
    },
  ),
}));

vi.mock('../../components/studio/StudioToolbar.js', () => ({
  StudioToolbar: () => <div>toolbar</div>,
}));

vi.mock('../../components/studio/StudioPalette.js', () => ({
  StudioPalette: () => <div>palette</div>,
}));

vi.mock('../../components/studio/StudioProperties.js', () => ({
  StudioProperties: () => <div>properties</div>,
}));

vi.mock('../../components/studio/StudioCanvas.js', () => ({
  StudioCanvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../components/studio/StudioPlacedPrefabs.js', () => ({
  StudioPlacedPrefabs: () => <div>placed-prefabs</div>,
}));

vi.mock('../../components/studio/StudioGhost.js', () => ({
  StudioGhost: () => <div>ghost</div>,
}));

vi.mock('../../components/studio/StudioPlotSelector.js', () => ({
  StudioPlotSelector: () => <div>plot-selector</div>,
}));

describe('StudioPage', () => {
  it('shows zone mode guidance by default', () => {
    render(<StudioPage mode="create" repos={null} onBack={vi.fn()} />);

    expect(screen.getByText('Zone Mode')).toBeTruthy();
    expect(screen.getByText('Shape the office first, then refine each zone.')).toBeTruthy();
    expect(
      screen.getByText('Select a zone to focus it, then enter decoration mode to work inside it.'),
    ).toBeTruthy();
  });

  it('shows placement guidance when a prefab is being positioned', () => {
    storeState.placingPrefab = { name: 'Focus Pod' };

    render(<StudioPage mode="create" repos={null} onBack={vi.fn()} />);

    expect(screen.getByText('Placing Focus Pod')).toBeTruthy();
    expect(
      screen.getByText('Click a valid floor area to place it. Use R to rotate before confirming.'),
    ).toBeTruthy();

    storeState.placingPrefab = null;
  });
});
