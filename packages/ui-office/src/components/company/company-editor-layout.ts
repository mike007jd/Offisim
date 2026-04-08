import type { ZoneLayoutMap } from '../office/OfficeEditorOverlay.js';

export function parseZoneLayoutMap(layoutJson?: string | null): ZoneLayoutMap {
  if (!layoutJson) return {};

  try {
    const parsed = JSON.parse(layoutJson) as Record<string, unknown>;
    if (
      parsed.zoneProps &&
      typeof parsed.zoneProps === 'object' &&
      !Array.isArray(parsed.zoneProps)
    ) {
      return parsed.zoneProps as ZoneLayoutMap;
    }
  } catch {
    return {};
  }

  return {};
}
