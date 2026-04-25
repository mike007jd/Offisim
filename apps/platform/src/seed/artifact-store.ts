/**
 * In-memory store for seeded Offisim official package artifacts.
 *
 * The seeder regenerates each .offisimpkg zip deterministically from its
 * payload every boot and stashes the bytes here keyed by `package_version_id`.
 * The `/v1/install/artifacts/:versionId` route reads from this map so that
 * install flows survive platform restarts without needing external hosting.
 *
 * This is NOT a persistence layer — contents are rebuilt on process start.
 */
const store = new Map<string, Uint8Array>();

export interface SeededArtifact {
  readonly bytes: Uint8Array;
  readonly size: number;
}

export function setSeededArtifact(packageVersionId: string, bytes: Uint8Array): void {
  store.set(packageVersionId, bytes);
}

export function getSeededArtifact(packageVersionId: string): SeededArtifact | undefined {
  const bytes = store.get(packageVersionId);
  if (!bytes) return undefined;
  return { bytes, size: bytes.byteLength };
}

export function clearSeededArtifacts(): void {
  store.clear();
}
