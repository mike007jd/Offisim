import type { SopDefinition } from '@offisim/shared-types';

/** Parse a SopDefinition JSON string, returning null if invalid or empty. */
export function parseSopDefinition(json: string): SopDefinition | null {
  try {
    const def = JSON.parse(json) as SopDefinition;
    return Array.isArray(def.steps) && def.steps.length > 0 ? def : null;
  } catch {
    return null;
  }
}

