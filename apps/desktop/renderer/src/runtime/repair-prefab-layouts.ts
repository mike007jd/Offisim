import type { RuntimeRepositories } from '@offisim/core/browser';
import { getBuiltinPrefab } from '@offisim/renderer';
import {
  type PrefabDefinition,
  type PrefabInstanceRow,
  type PrefabPlacementBoundsInput,
  SYSTEM_PREFAB_LAYOUT_VERSION,
  type ZoneRow,
  extractZoneSlug,
  findPrefabPlacementOverlaps,
  prefabFitsWithinZone,
  prefabPlacementBounds,
} from '@offisim/shared-types';

const REPAIR_MARKER_PREFIX = `office.prefab-layout-repair.${SYSTEM_PREFAB_LAYOUT_VERSION}.bbox-v1`;
const REPAIR_GRID_STEP = 0.5;
const POSITION_EPSILON = 0.01;
const ROTATIONS: readonly PrefabInstanceRow['rotation'][] = [0, 90, 180, 270];

type RepairablePrefab = {
  readonly instance: PrefabInstanceRow;
  readonly definition: PrefabDefinition;
};

type RepairPatch = {
  readonly instanceId: string;
  readonly x: number;
  readonly z: number;
  readonly rotation: PrefabInstanceRow['rotation'];
};

function toPlacementInput(
  prefab: RepairablePrefab,
  x = prefab.instance.position_x,
  z = prefab.instance.position_y,
  rotation = prefab.instance.rotation,
): PrefabPlacementBoundsInput {
  return {
    id: prefab.instance.instance_id,
    prefabId: prefab.definition.prefabId,
    x,
    z,
    rotation,
    gridSize: prefab.definition.gridSize,
  };
}

function zoneBounds(zone: ZoneRow) {
  return { cx: zone.cx, cz: zone.cz, w: zone.w, d: zone.d };
}

function placementArea(prefab: RepairablePrefab): number {
  const bounds = prefabPlacementBounds(toPlacementInput(prefab));
  return (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
}

function placementFits(
  candidate: PrefabPlacementBoundsInput,
  zone: ZoneRow,
  accepted: readonly PrefabPlacementBoundsInput[],
): boolean {
  return (
    prefabFitsWithinZone(candidate, zoneBounds(zone)) &&
    findPrefabPlacementOverlaps(candidate, accepted).length === 0
  );
}

function pointKey(x: number, z: number): string {
  return `${x.toFixed(2)}:${z.toFixed(2)}`;
}

function prefabCandidatePoints(
  zone: ZoneRow,
  originX: number,
  originZ: number,
): { readonly x: number; readonly z: number }[] {
  const points = new Map<string, { x: number; z: number }>();
  const add = (x: number, z: number) => {
    const px = Number(x.toFixed(2));
    const pz = Number(z.toFixed(2));
    points.set(pointKey(px, pz), { x: px, z: pz });
  };

  add(originX, originZ);
  add(zone.cx, zone.cz);

  const minX = zone.cx - zone.w / 2;
  const maxX = zone.cx + zone.w / 2;
  const minZ = zone.cz - zone.d / 2;
  const maxZ = zone.cz + zone.d / 2;

  for (let x = minX; x <= maxX + POSITION_EPSILON; x += REPAIR_GRID_STEP) {
    for (let z = minZ; z <= maxZ + POSITION_EPSILON; z += REPAIR_GRID_STEP) {
      add(x, z);
    }
  }

  return [...points.values()].sort(
    (a, b) =>
      Math.hypot(a.x - originX, a.z - originZ) - Math.hypot(b.x - originX, b.z - originZ) ||
      a.z - b.z ||
      a.x - b.x,
  );
}

function repairCandidatePlacements(
  prefab: RepairablePrefab,
  zone: ZoneRow,
): PrefabPlacementBoundsInput[] {
  const rotations = [
    prefab.instance.rotation,
    ...ROTATIONS.filter((rotation) => rotation !== prefab.instance.rotation),
  ];
  return prefabCandidatePoints(
    zone,
    prefab.instance.position_x,
    prefab.instance.position_y,
  ).flatMap((point) =>
    rotations.map((rotation) => toPlacementInput(prefab, point.x, point.z, rotation)),
  );
}

function repairZonePrefabs(
  zone: ZoneRow,
  prefabs: readonly RepairablePrefab[],
): { readonly patches: readonly RepairPatch[]; readonly unresolved: readonly string[] } {
  const accepted: PrefabPlacementBoundsInput[] = [];
  const patches: RepairPatch[] = [];
  const unresolved: string[] = [];

  for (const prefab of prefabs) {
    const current = toPlacementInput(prefab);
    if (placementFits(current, zone, accepted)) {
      accepted.push(current);
      continue;
    }

    const next = repairCandidatePlacements(prefab, zone).find((candidate) =>
      placementFits(candidate, zone, accepted),
    );

    if (!next) {
      unresolved.push(prefab.instance.instance_id);
      accepted.push(current);
      continue;
    }

    accepted.push(next);
    if (
      Math.abs(next.x - prefab.instance.position_x) > POSITION_EPSILON ||
      Math.abs(next.z - prefab.instance.position_y) > POSITION_EPSILON ||
      next.rotation !== prefab.instance.rotation
    ) {
      patches.push({
        instanceId: prefab.instance.instance_id,
        x: next.x,
        z: next.z,
        rotation: next.rotation ?? prefab.instance.rotation,
      });
    }
  }

  return { patches, unresolved };
}

async function repairCompanyPrefabLayout(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<boolean> {
  const [zones, prefabRows] = await Promise.all([
    repos.zones.findByCompany(companyId),
    repos.prefabInstances.findByCompany(companyId),
  ]);
  const zonesBySlug = new Map(zones.map((zone) => [extractZoneSlug(zone.zone_id), zone]));
  const prefabsByZoneSlug = new Map<string, RepairablePrefab[]>();

  for (const instance of prefabRows) {
    if (!instance.enabled) continue;
    const definition = getBuiltinPrefab(instance.prefab_id);
    if (!definition) continue;
    const slug = extractZoneSlug(instance.zone_id);
    const zone = zonesBySlug.get(slug);
    if (!zone) continue;
    const items = prefabsByZoneSlug.get(slug) ?? [];
    items.push({ instance, definition });
    prefabsByZoneSlug.set(slug, items);
  }

  let fullyResolved = true;
  for (const [slug, prefabs] of prefabsByZoneSlug) {
    const zone = zonesBySlug.get(slug);
    if (!zone) continue;
    const ordered = [...prefabs].sort(
      (a, b) =>
        placementArea(b) - placementArea(a) ||
        a.instance.position_y - b.instance.position_y ||
        a.instance.position_x - b.instance.position_x ||
        a.instance.instance_id.localeCompare(b.instance.instance_id),
    );
    const result = repairZonePrefabs(zone, ordered);
    if (result.unresolved.length > 0) fullyResolved = false;
    // Distinct instance ids — the row updates are independent writes.
    await Promise.all(
      result.patches.map((patch) =>
        repos.prefabInstances.update(patch.instanceId, {
          position_x: patch.x,
          position_y: patch.z,
          rotation: patch.rotation,
        }),
      ),
    );
  }

  return fullyResolved;
}

export async function repairPersistedPrefabLayouts(repos: RuntimeRepositories): Promise<void> {
  if (!repos.settings) return;

  const companies = (await repos.companies.findAll()).filter(
    (company) => company.status !== 'archived',
  );
  for (const company of companies) {
    const marker = `${REPAIR_MARKER_PREFIX}.${company.company_id}`;
    if ((await repos.settings.get(marker)) === 'true') continue;
    const resolved = await repairCompanyPrefabLayout(repos, company.company_id);
    if (resolved) {
      await repos.settings.set(marker, 'true');
    }
  }
}
