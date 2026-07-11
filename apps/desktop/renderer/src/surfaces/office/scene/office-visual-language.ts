import type {
  CharacterStatus,
  StagingPrefab,
  SurfacedResourceSeverity,
} from '@offisim/shared-types';
import { OFFICE_TOY_SIGNAL_COLORS, OFFICE_TOY_STATE_COLORS } from './r3d/scene-colors.js';

/** Shared world location of the physical delivery tray and its flow endpoint. */
export const OFFICE_DELIVERY_WORLD = {
  // The open aisle between the default Library and Rest zones. This is inside
  // the opening camera frustum and outside every seeded zone/prefab footprint.
  x: -2.65,
  z: 0.65,
} as const;

/**
 * Virtual prefab consumed by the normal staging reservation pipeline. It is
 * renderer geometry, not persisted layout data, and gives both 2D and 3D the
 * same semantic destination without special-casing projectOfficeStaging.
 */
export const OFFICE_DELIVERY_STAGING_PREFAB: StagingPrefab = {
  instanceId: '__office-delivery-shelf',
  prefabId: 'office-delivery-shelf',
  x: OFFICE_DELIVERY_WORLD.x,
  z: OFFICE_DELIVERY_WORLD.z,
  rotation: 0,
};

export const CHARACTER_INDICATOR_GEOMETRY = {
  baseDiscRadius: 0.46,
  workingDiscRadius: 0.52,
  stateRingInner: 0.47,
  stateRingOuter: 0.56,
  selectedRingInner: 0.61,
  selectedRingOuter: 0.66,
  headMarkerSize: 0.16,
  dotRadius: 0.032,
  dotAmplitude: 0.04,
} as const;

type CharacterIndicatorLayerId =
  | 'base-disc'
  | 'working-disc'
  | 'approval-ring'
  | 'approval-marker'
  | 'blocked-segments'
  | 'blocked-marker'
  | 'working-dots'
  | 'selected-ring';

export interface CharacterIndicatorPresentation {
  readonly status: CharacterStatus;
  readonly selected: boolean;
  readonly layers: readonly CharacterIndicatorLayerId[];
  readonly dots: 0 | 3;
  readonly dotsAnimated: boolean;
  readonly stateColor: string | null;
  readonly selectedColor: string;
}

/** Non-blocking typed strain stays slate; only blocked/exhausted may use red. */
export function officeResourceMarkerColor(severity: SurfacedResourceSeverity): string {
  return severity === 'warning'
    ? OFFICE_TOY_SIGNAL_COLORS.neutral
    : OFFICE_TOY_STATE_COLORS.blocked;
}

/**
 * Pure P4 indicator contract. It produces at most one business ground layer,
 * one optional head confirmation and one orthogonal selected ring. The React
 * renderer consumes these ids directly; the phase gate checks the same value.
 */
export function characterIndicatorPresentation(
  status: CharacterStatus,
  selected: boolean,
  reducedMotion: boolean,
  dragging = false,
  hasTypedResourceMarker = false,
): CharacterIndicatorPresentation {
  if (dragging) {
    return {
      status,
      selected: false,
      layers: [],
      dots: 0,
      dotsAnimated: false,
      stateColor: null,
      selectedColor: OFFICE_TOY_STATE_COLORS.selected,
    };
  }

  const layers: CharacterIndicatorLayerId[] = ['base-disc'];
  let stateColor: string | null = null;
  if (status === 'working') {
    layers.push('working-disc', 'working-dots');
    stateColor = OFFICE_TOY_STATE_COLORS.working;
  } else if (status === 'approval') {
    layers.push('approval-ring', 'approval-marker');
    stateColor = OFFICE_TOY_STATE_COLORS.approval;
  } else if (status === 'blocked') {
    layers.push('blocked-segments');
    if (!hasTypedResourceMarker) layers.push('blocked-marker');
    stateColor = OFFICE_TOY_STATE_COLORS.blocked;
  }
  if (selected) layers.push('selected-ring');

  return {
    status,
    selected,
    layers,
    dots: status === 'working' ? 3 : 0,
    dotsAnimated: status === 'working' && !reducedMotion,
    stateColor,
    selectedColor: OFFICE_TOY_STATE_COLORS.selected,
  };
}
