/** Interaction anchor kinds — identical to the dramaturgy BeatAffordance union. */
export type InteractionAnchorKind =
  | 'workstation'
  | 'meeting-seat'
  | 'board-presenter'
  | 'standing-review'
  | 'reading-seat'
  | 'library-inspect'
  | 'refreshment'
  | 'server-inspect'
  | 'social-seat'
  | 'delivery-shelf';

/** A single interaction point on a prefab, in prefab-local space. */
export interface InteractionAnchor {
  readonly kind: InteractionAnchorKind;
  /** Local offset [x, z] from the prefab origin (world units). */
  readonly offset: readonly [number, number];
  /** Facing in degrees, local (0 faces +z). Combined with prefab rotation. */
  readonly rotation: number;
  readonly posture: 'sitting' | 'standing';
}

/** A placed prefab instance in world space. */
export interface StagingPrefab {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly x: number;
  readonly z: number;
  readonly rotation: 0 | 90 | 180 | 270;
  /**
   * Content scale the renderer applies to seat offsets (both the 2D and 3D
   * scenes pass SCENE_CONTENT_SCALE, since the home-seat planner scales offsets in
   * both modes). Anchor offsets are multiplied by it so a relocated actor lands on
   * the same scaled seat as a resting one. Explicit shared data — shared-types
   * never reads a hidden renderer constant. Omitted/undefined = 1.
   */
  readonly scale?: number;
}

/** A world-space interaction anchor expanded from a placed prefab. */
export interface WorldAnchor {
  /** Stable id `${instanceId}#${localIndex}` — also the reservation key. */
  readonly anchorId: string;
  readonly instanceId: string;
  readonly kind: InteractionAnchorKind;
  readonly x: number;
  readonly z: number;
  /** Facing in degrees (0 faces +z), world space. */
  readonly facing: number;
  readonly posture: 'sitting' | 'standing';
}

export interface StagingRequest {
  readonly actorId: string;
  readonly affordance: InteractionAnchorKind;
  /** Beat priority — higher reserves a scarce anchor first. */
  readonly priority: number;
  /** Beat time — earlier reserves first among equal priority. */
  readonly at: number;
  /** Actor's current position, for nearest-anchor selection. Omit for first-free. */
  readonly x?: number;
  readonly z?: number;
}

export interface ActorStaging {
  readonly actorId: string;
  readonly affordance: InteractionAnchorKind;
  /** Reserved anchor, or null when the office has no free anchor of that kind. */
  readonly anchorId: string | null;
  readonly x: number | null;
  readonly z: number | null;
  readonly facing: number | null;
  readonly posture: 'sitting' | 'standing' | null;
}
