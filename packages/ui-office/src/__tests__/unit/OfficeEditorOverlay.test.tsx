import { render, screen } from '@testing-library/react';
import { OfficeEditorOverlay } from '../../components/office/OfficeEditorOverlay';

vi.mock('../../components/office/editor/useOfficeEditor.js', () => ({
  useOfficeEditor: () => ({
    editorZones: [],
    localItems: [],
    selectedZoneId: null,
    selectedZone: null,
    placingPreset: null,
    ghostPos: null,
    drag: null,
    saving: false,
    dirty: false,
    collapsed: {},
    showCustomForm: false,
    customLabel: 'Custom Zone',
    customArchetype: 'workspace',
    allPrefabsMap: new Map(),
    itemsByZone: new Map(),
    overlapMap: new Map(),
    ghostOverlaps: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    viewBox: '0 0 100 100',
    svgRef: { current: null },
    setCollapsed: vi.fn(),
    setShowCustomForm: vi.fn(),
    setCustomLabel: vi.fn(),
    setCustomArchetype: vi.fn(),
    setPlacingPreset: vi.fn(),
    setSelectedZoneId: vi.fn(),
    handlePresetClick: vi.fn(),
    handleCanvasPointerDown: vi.fn(),
    handleCanvasMouseMove: vi.fn(),
    handleCanvasPointerUp: vi.fn(),
    handleCanvasMouseLeave: vi.fn(),
    handleZonePointerDown: vi.fn(),
    handleDeleteZone: vi.fn(),
    handleMoveZone: vi.fn(),
    handleLabelChange: vi.fn(),
    handleCreateCustom: vi.fn(),
    handleResetAll: vi.fn(),
    handleSave: vi.fn(),
    handleWheel: vi.fn(),
    handleZoomIn: vi.fn(),
    handleZoomOut: vi.fn(),
    handleZoomFit: vi.fn(),
    handleSwapVariant: vi.fn(),
    selectedZoneRequired: false,
    warning: null,
  }),
}));

describe('OfficeEditorOverlay', () => {
  it('frames studio as office edit mode rather than a separate top-level workspace', () => {
    render(<OfficeEditorOverlay open onClose={vi.fn()} />);

    expect(screen.getByText('OFFICE STUDIO')).toBeInTheDocument();
    expect(screen.getByText('ZONE EDIT MODE')).toBeInTheDocument();
  });
});
