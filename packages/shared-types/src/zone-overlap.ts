// ── Zone Overlap Detection ─────────────────────────────────────────
// AABB overlap checks for zone placement validation.

export interface ZoneRect {
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
}

/** Check if two zones overlap (AABB intersection). */
export function zonesOverlap(a: ZoneRect, b: ZoneRect): boolean {
  const aLeft = a.cx - a.w / 2;
  const aRight = a.cx + a.w / 2;
  const aTop = a.cz - a.d / 2;
  const aBottom = a.cz + a.d / 2;

  const bLeft = b.cx - b.w / 2;
  const bRight = b.cx + b.w / 2;
  const bTop = b.cz - b.d / 2;
  const bBottom = b.cz + b.d / 2;

  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

/** Find all zones that overlap with a candidate rect. Exclude the candidate itself by ID. */
export function findOverlaps<T extends ZoneRect & { id: string }>(
  candidate: ZoneRect & { id: string },
  zones: readonly T[],
): T[] {
  return zones.filter((z) => z.id !== candidate.id && zonesOverlap(candidate, z));
}

/** Compute overlap map: for each zone, list the IDs of zones it overlaps with. */
export function computeOverlapMap<T extends ZoneRect & { id: string }>(
  zones: readonly T[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i]!;
      const b = zones[j]!;
      if (zonesOverlap(a, b)) {
        let aList = map.get(a.id);
        if (!aList) { aList = []; map.set(a.id, aList); }
        aList.push(b.id);

        let bList = map.get(b.id);
        if (!bList) { bList = []; map.set(b.id, bList); }
        bList.push(a.id);
      }
    }
  }
  return map;
}
