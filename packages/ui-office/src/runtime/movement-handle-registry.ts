import type { CharacterMovementHandle } from '../hooks/useCharacterMovement';

/** Per-company registry for movement handles — prevents cross-company leaks. */
const companyHandles = new Map<string, Map<string, CharacterMovementHandle>>();

function getHandleMap(companyId: string): Map<string, CharacterMovementHandle> {
  let map = companyHandles.get(companyId);
  if (!map) {
    map = new Map();
    companyHandles.set(companyId, map);
  }
  return map;
}

/** Returns the live handle map for a company (or empty map). */
export function getMovementHandles(companyId: string): Map<string, CharacterMovementHandle> {
  return companyHandles.get(companyId) ?? new Map();
}

export function getMovementHandle(
  companyId: string,
  employeeId: string,
): CharacterMovementHandle | undefined {
  return getMovementHandles(companyId).get(employeeId);
}

export function registerMovementHandle(
  companyId: string,
  employeeId: string,
  handle: CharacterMovementHandle,
) {
  // Safety cap: evict oldest company entries if too many accumulate (FIFO by Map insertion order)
  if (!companyHandles.has(companyId) && companyHandles.size >= 5) {
    const oldest = companyHandles.keys().next().value;
    if (oldest !== undefined) companyHandles.delete(oldest);
  }

  const map = getHandleMap(companyId);
  map.set(employeeId, handle);

  // Warn if a single company accumulates too many handles (likely a leak)
  if (map.size > 200) {
    console.warn(
      `[movement-handle-registry] company "${companyId}" has ${map.size} movement handles — possible leak`,
    );
  }
}

export function unregisterMovementHandle(companyId: string, employeeId: string) {
  const map = companyHandles.get(companyId);
  if (map) {
    map.delete(employeeId);
    if (map.size === 0) companyHandles.delete(companyId);
  }
}

export function getMovementDebugInfo(companyId: string): Array<{
  id: string;
  x: number;
  y: number;
  isMoving: boolean;
}> {
  return [...getMovementHandles(companyId).entries()]
    .map(([id, handle]) => {
      const position = handle.getPosition();
      if (!position) return null;
      return {
        id,
        x: position[0],
        y: position[2],
        isMoving: handle.isMoving(),
      };
    })
    .filter(
      (entry): entry is { id: string; x: number; y: number; isMoving: boolean } => entry != null,
    );
}

/** Clear all movement handles for a company (call on unmount / company switch). */
export function clearMovementHandlesForCompany(companyId: string): void {
  companyHandles.delete(companyId);
}
