/**
 * Office projection (Phase 4 core, source plan §6 / §13 Office mode).
 *
 * Turns a beat timeline + the real office prefab layout into per-employee scene
 * direction: each employee's current performance, and — only for high-value
 * MOVEMENT beats — a reserved relocation anchor. Micro-action beats (read /
 * search / type / inspect) change performance in place with no anchor, so the
 * office moves only for high-value beats; tool chatter never causes walking.
 *
 * Pure and deterministic: the 2D and 3D scenes consume this same projection, so
 * a beat directs the same actor to the same place in both render modes.
 */
import type { EmployeeStaging, SceneBeat } from '@offisim/shared-types';
import { performanceForBeat } from './performance.js';
import { type StagingPrefab, type StagingRequest, reserveStaging } from './staging.js';
export type { EmployeeStaging } from '@offisim/shared-types';

/**
 * The current (latest) beat per employee from an ordered beat timeline. Later
 * beats supersede earlier ones, so this is the actor's live state.
 */
export function currentBeatsByEmployee(beats: readonly SceneBeat[]): Map<string, SceneBeat> {
  const map = new Map<string, SceneBeat>();
  for (const beat of beats) {
    if (beat.employeeId) map.set(beat.employeeId, beat);
  }
  return map;
}

export function projectOfficeStaging(
  beats: readonly SceneBeat[],
  prefabs: readonly StagingPrefab[],
  actorPositions?: ReadonlyMap<string, { readonly x: number; readonly z: number }>,
): EmployeeStaging[] {
  const current = currentBeatsByEmployee(beats);

  // Only high-value movement beats reserve a relocation anchor. Each request
  // carries the beat's priority + time (so reservation favours high-priority
  // actors) and the actor's current position (so it takes the nearest anchor).
  const movers: StagingRequest[] = [];
  for (const [employeeId, beat] of current) {
    if (beat.movement && beat.affordance) {
      const pos = actorPositions?.get(employeeId);
      movers.push({
        actorId: employeeId,
        affordance: beat.affordance,
        priority: beat.priority,
        at: beat.at,
        ...(pos ? { x: pos.x, z: pos.z } : {}),
      });
    }
  }
  const reservedByActor = new Map(reserveStaging(prefabs, movers).map((s) => [s.actorId, s]));

  const out: EmployeeStaging[] = [];
  for (const [employeeId, beat] of current) {
    out.push({
      employeeId,
      beat,
      performance: performanceForBeat(beat),
      staging: reservedByActor.get(employeeId) ?? null,
    });
  }
  // Deterministic order for stable consumption by the scene.
  return out.sort((a, b) =>
    a.employeeId < b.employeeId ? -1 : a.employeeId > b.employeeId ? 1 : 0,
  );
}
