import { describe, expect, it } from 'vitest';
import { getWorkspaceCenterPaneMode } from './workspace-center-pane-mode';

describe('getWorkspaceCenterPaneMode', () => {
  it('treats the office view as the live office scene', () => {
    expect(getWorkspaceCenterPaneMode('office')).toBe('office-scene');
  });

  it('routes workspace pages into the shared surface container', () => {
    expect(getWorkspaceCenterPaneMode('sops')).toBe('workspace-surface');
    expect(getWorkspaceCenterPaneMode('market')).toBe('workspace-surface');
    expect(getWorkspaceCenterPaneMode('activity-log')).toBe('workspace-surface');
    expect(getWorkspaceCenterPaneMode('library')).toBe('workspace-surface');
    expect(getWorkspaceCenterPaneMode('server')).toBe('workspace-surface');
  });

  it('keeps overlays and non-workspace routes out of the center pane switch', () => {
    expect(getWorkspaceCenterPaneMode('employee-creator')).toBe('none');
    expect(getWorkspaceCenterPaneMode('office-editor')).toBe('none');
    expect(getWorkspaceCenterPaneMode('company-select')).toBe('none');
    expect(getWorkspaceCenterPaneMode('studio')).toBe('none');
  });
});
