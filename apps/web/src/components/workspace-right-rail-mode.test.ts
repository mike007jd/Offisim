import { describe, expect, it } from 'vitest';
import { getWorkspaceRightRailMode } from './workspace-right-rail-mode';

describe('getWorkspaceRightRailMode', () => {
  it('keeps the office view in the full collaboration-plus-results mode', () => {
    expect(getWorkspaceRightRailMode('office')).toBe('office');
  });

  it('routes activity log to task-focused support mode', () => {
    expect(getWorkspaceRightRailMode('activity-log')).toBe('tasks');
  });

  it('keeps SOPs in collaboration mode without office-space entry cards', () => {
    expect(getWorkspaceRightRailMode('sops')).toBe('collaboration');
  });

  it('treats the remaining workspace surfaces as space-entry plus collaboration mode', () => {
    expect(getWorkspaceRightRailMode('market')).toBe('spaces-and-collaboration');
    expect(getWorkspaceRightRailMode('library')).toBe('spaces-and-collaboration');
    expect(getWorkspaceRightRailMode('server')).toBe('spaces-and-collaboration');
  });
});
