import type { Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  getOfficeSpaceEntryViews,
  hasWorkspaceSurfaceZone,
  WORKSPACE_SURFACE_META,
} from './workspace-surface-meta';

function makeZone(archetype: Zone['archetype']): Zone {
  return {
    zoneId: `company::${archetype ?? 'unknown'}`,
    companyId: 'company',
    kind: 'system',
    label: archetype ?? 'Unknown',
    archetype,
    accentColor: '#000000',
    floorColor: 0,
    cx: 0,
    cz: 0,
    w: 4,
    d: 4,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: [],
    deskSlots: 0,
    sortOrder: 0,
  };
}

describe('WorkspaceSurface helpers', () => {
  it('only exposes office-space entry views when matching zones exist', () => {
    expect(getOfficeSpaceEntryViews([])).toEqual([]);
    expect(getOfficeSpaceEntryViews([makeZone('library')])).toEqual(['library']);
    expect(getOfficeSpaceEntryViews([makeZone('server')])).toEqual(['server']);
    expect(getOfficeSpaceEntryViews([makeZone('server'), makeZone('library')])).toEqual([
      'library',
      'server',
    ]);
  });

  it('treats non-space workspace surfaces as globally available', () => {
    expect(hasWorkspaceSurfaceZone('sops', [])).toBe(true);
    expect(hasWorkspaceSurfaceZone('market', [])).toBe(true);
    expect(hasWorkspaceSurfaceZone('activity-log', [])).toBe(true);
  });

  it('keeps office-space entry copy centralized in the surface metadata', () => {
    expect(WORKSPACE_SURFACE_META.library.entryDescription).toContain('knowledge shelf');
    expect(WORKSPACE_SURFACE_META.server.entryDescription).toContain('office environment');
  });
});
