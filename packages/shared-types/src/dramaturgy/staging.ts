/**
 * Prefab interaction affordances + deterministic anchor reservation (Phase 3,
 * source plan §7).
 *
 * Prefabs declare interaction anchors by KIND (workstation, meeting-seat, …).
 * The dramaturgy layer asks "stage these actors at affordance X" and gets back
 * world-space placements with no two actors on the same reserved anchor. This
 * is data-driven from the office's real prefab layout, so custom offices and
 * Studio-edited offices stage correctly with no template-ID coordinate
 * branches, and the same input yields the same placement in 2D and 3D.
 */

import { normalizeRotation, rotateLocalXZ } from '../prefab-spatial.js';

/** Interaction anchor kinds — identical to the dramaturgy BeatAffordance union. */
export type InteractionAnchorKind =
  | 'workstation'
  | 'meeting-seat'
  | 'board-presenter'
  | 'standing-review'
  | 'reading-seat'
  | 'server-inspect'
  | 'social-seat';

/** A single interaction point on a prefab, in prefab-local space. */
export interface InteractionAnchor {
  readonly kind: InteractionAnchorKind;
  /** Local offset [x, z] from the prefab origin (world units). */
  readonly offset: readonly [number, number];
  /** Facing in degrees, local (0 faces +z). Combined with prefab rotation. */
  readonly rotation: number;
  readonly posture: 'sitting' | 'standing';
}

const a = (
  kind: InteractionAnchorKind,
  offset: [number, number],
  rotation: number,
  posture: 'sitting' | 'standing',
): InteractionAnchor => ({ kind, offset, rotation, posture });

/**
 * Interaction anchors per built-in prefab. Capacity is the count of anchors of
 * a kind (each anchor seats one actor). Prefabs with no interaction value
 * (plants, switches, cabling) are simply absent.
 */
export const BUILTIN_PREFAB_AFFORDANCES: Readonly<Record<string, readonly InteractionAnchor[]>> = {
  'workstation-standard': [a('workstation', [0, 0.55], 180, 'sitting')],
  'workstation-compact': [a('workstation', [0, 0.5], 180, 'sitting')],
  'workstation-dual': [a('workstation', [0, 0.55], 180, 'sitting')],
  'server-rack-2u': [a('server-inspect', [0, 0.95], 180, 'standing')],
  'server-rack-4u': [a('server-inspect', [0, 1.0], 180, 'standing')],
  'gpu-cluster': [
    a('server-inspect', [-1.1, 1.0], 180, 'standing'),
    a('server-inspect', [1.1, 1.0], 180, 'standing'),
  ],
  'bookshelf-single': [a('reading-seat', [0, 0.7], 180, 'standing')],
  'bookshelf-double': [
    a('reading-seat', [-0.7, 0.7], 180, 'standing'),
    a('reading-seat', [0.7, 0.7], 180, 'standing'),
  ],
  'reading-table': [
    a('reading-seat', [0, 0.7], 180, 'sitting'),
    a('reading-seat', [0, -0.7], 0, 'sitting'),
  ],
  whiteboard: [a('board-presenter', [0, 0.85], 180, 'standing')],
  'status-board': [a('board-presenter', [0, 0.85], 180, 'standing')],
  'standing-table': [
    a('standing-review', [-0.8, 0.55], 180, 'standing'),
    a('standing-review', [0.8, 0.55], 180, 'standing'),
    a('standing-review', [0, -0.55], 0, 'standing'),
  ],
  'meeting-table-4': [
    a('meeting-seat', [0, 1.35], 180, 'sitting'),
    a('meeting-seat', [0, -1.35], 0, 'sitting'),
    a('meeting-seat', [1.35, 0], 270, 'sitting'),
    a('meeting-seat', [-1.35, 0], 90, 'sitting'),
  ],
  'meeting-table-8': [
    a('meeting-seat', [-1.3, 1.6], 180, 'sitting'),
    a('meeting-seat', [0, 1.6], 180, 'sitting'),
    a('meeting-seat', [1.3, 1.6], 180, 'sitting'),
    a('meeting-seat', [-1.3, -1.6], 0, 'sitting'),
    a('meeting-seat', [0, -1.6], 0, 'sitting'),
    a('meeting-seat', [1.3, -1.6], 0, 'sitting'),
    a('meeting-seat', [2.6, 0], 270, 'sitting'),
    a('meeting-seat', [-2.6, 0], 90, 'sitting'),
  ],
  'sofa-set': [
    a('social-seat', [-1.2, 0.4], 180, 'sitting'),
    a('social-seat', [0, 0.4], 180, 'sitting'),
    a('social-seat', [1.2, 0.4], 180, 'sitting'),
  ],
  'chair-standalone': [a('social-seat', [0, 0], 0, 'sitting')],
};

export function builtinPrefabAffordances(prefabId: string): readonly InteractionAnchor[] {
  return BUILTIN_PREFAB_AFFORDANCES[prefabId] ?? [];
}

// ── World-space reservation ─────────────────────────────────────────────────

/** A placed prefab instance in world space. */
export interface StagingPrefab {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly x: number;
  readonly z: number;
  readonly rotation: 0 | 90 | 180 | 270;
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

/**
 * Expand all prefab instances into world-space anchors, in a deterministic
 * order (by instanceId, then local anchor index). Rotation uses the shared
 * `rotateLocalXZ` so affordance anchors, collision bounds, and 2D/3D seat math
 * can never diverge.
 */
export function worldAnchorsFor(
  prefabs: readonly StagingPrefab[],
  affordances: (prefabId: string) => readonly InteractionAnchor[] = builtinPrefabAffordances,
): WorldAnchor[] {
  const out: WorldAnchor[] = [];
  const sorted = [...prefabs].sort((p, q) => (p.instanceId < q.instanceId ? -1 : p.instanceId > q.instanceId ? 1 : 0));
  for (const prefab of sorted) {
    affordances(prefab.prefabId).forEach((anchor, index) => {
      const [dx, dz] = rotateLocalXZ(anchor.offset[0], anchor.offset[1], prefab.rotation);
      out.push({
        anchorId: `${prefab.instanceId}#${index}`,
        instanceId: prefab.instanceId,
        kind: anchor.kind,
        x: prefab.x + dx,
        z: prefab.z + dz,
        facing: normalizeRotation(anchor.rotation + prefab.rotation),
        posture: anchor.posture,
      });
    });
  }
  return out;
}

/**
 * Reserve one anchor per request with no double-booking, deterministically.
 *
 * Requests are processed in actorId order and each takes the first still-free
 * world anchor of the matching kind (anchors are pre-sorted by instanceId then
 * local index). A request with no free matching anchor resolves to a null
 * placement (the scene keeps that actor at their home zone). Pure and order-
 * independent: the same prefab layout + requests always yields the same map,
 * so 2D and 3D stage identically.
 */
export function reserveStaging(
  prefabs: readonly StagingPrefab[],
  requests: readonly StagingRequest[],
  affordances: (prefabId: string) => readonly InteractionAnchor[] = builtinPrefabAffordances,
): ActorStaging[] {
  const anchors = worldAnchorsFor(prefabs, affordances);
  // Reserve by array index, not by anchorId string, so two physically distinct
  // anchors are never collapsed even in the degenerate case of a caller passing
  // two prefab instances that share an instanceId (DB `instance_id` is a PK, so
  // this cannot happen on real data — but the no-double-book guarantee holds
  // unconditionally).
  const reserved = new Set<number>();
  const ordered = [...requests].sort((p, q) => (p.actorId < q.actorId ? -1 : p.actorId > q.actorId ? 1 : 0));
  return ordered.map((req) => {
    const index = anchors.findIndex((w, i) => w.kind === req.affordance && !reserved.has(i));
    if (index < 0) {
      return { actorId: req.actorId, affordance: req.affordance, anchorId: null, x: null, z: null, facing: null, posture: null };
    }
    reserved.add(index);
    const anchor = anchors[index] as WorldAnchor;
    return {
      actorId: req.actorId,
      affordance: req.affordance,
      anchorId: anchor.anchorId,
      x: anchor.x,
      z: anchor.z,
      facing: anchor.facing,
      posture: anchor.posture,
    };
  });
}
