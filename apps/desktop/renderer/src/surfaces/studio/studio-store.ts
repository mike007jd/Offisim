import { create } from 'zustand';

export type StudioSelection =
  | { readonly kind: 'zone'; readonly id: string }
  | { readonly kind: 'object'; readonly id: string }
  | null;

export type StudioRotation = 0 | 90 | 180 | 270;

/** An active placement session: a prefab (focus mode) or a zone preset
 *  (overview) riding the cursor as a ghost. `drag` commits on pointer-up,
 *  `click` commits per click and stays active for repeat placement. */
export type StudioPlacement =
  | {
      readonly kind: 'prefab';
      readonly prefabId: string;
      readonly rotation: StudioRotation;
      readonly mode: 'drag' | 'click';
    }
  | {
      readonly kind: 'zone-preset';
      readonly presetId: string;
      readonly blank: boolean;
      readonly mode: 'drag' | 'click';
    };

interface StudioState {
  focusZoneId: string | null;
  selection: StudioSelection;
  placement: StudioPlacement | null;
  setFocusZone: (zoneId: string | null) => void;
  select: (selection: StudioSelection) => void;
  startPlacement: (placement: StudioPlacement) => void;
  rotatePlacement: () => void;
  endPlacement: () => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  focusZoneId: null,
  selection: null,
  placement: null,
  setFocusZone: (zoneId) =>
    set((state) => ({
      focusZoneId: zoneId,
      placement: null,
      // Entering focus selects the zone; leaving drops any object selection.
      selection: zoneId
        ? { kind: 'zone', id: zoneId }
        : state.selection?.kind === 'object'
          ? null
          : state.selection,
    })),
  select: (selection) => set({ selection }),
  startPlacement: (placement) => set({ placement }),
  rotatePlacement: () =>
    set((state) =>
      state.placement?.kind === 'prefab'
        ? {
            placement: {
              ...state.placement,
              rotation: ((state.placement.rotation + 90) % 360) as StudioRotation,
            },
          }
        : {},
    ),
  endPlacement: () => set({ placement: null }),
}));
