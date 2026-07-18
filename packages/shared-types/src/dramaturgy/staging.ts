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

export interface InteractionAnchor {
  readonly kind: InteractionAnchorKind;
  readonly offset: readonly [number, number];
  readonly rotation: number;
  readonly posture: 'sitting' | 'standing';
}

export interface StagingPrefab {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly x: number;
  readonly z: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly scale?: number;
}

export interface WorldAnchor {
  readonly anchorId: string;
  readonly instanceId: string;
  readonly kind: InteractionAnchorKind;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly posture: 'sitting' | 'standing';
}

export interface StagingRequest {
  readonly actorId: string;
  readonly affordance: InteractionAnchorKind;
  readonly priority: number;
  readonly at: number;
  readonly x?: number;
  readonly z?: number;
}

export interface ActorStaging {
  readonly actorId: string;
  readonly affordance: InteractionAnchorKind;
  readonly anchorId: string | null;
  readonly x: number | null;
  readonly z: number | null;
  readonly facing: number | null;
  readonly posture: 'sitting' | 'standing' | null;
}
