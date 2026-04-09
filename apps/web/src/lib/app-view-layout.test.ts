import { describe, expect, it } from 'vitest';
import {
  FULL_PAGE_WORKSPACE_VIEWS,
  WORKSPACE_VIEWS,
  isFullPageWorkspaceView,
  isOfficeSceneInteractive,
  isWorkspaceView,
  shouldShowAppShell,
  shouldShowEmployeeCreatorOverlay,
} from './app-view-layout';

describe('app view layout helpers', () => {
  it('tracks workspace and full-page workspace views explicitly', () => {
    expect(WORKSPACE_VIEWS).toEqual(['office', 'sops', 'market', 'activity-log', 'settings']);
    expect(FULL_PAGE_WORKSPACE_VIEWS).toEqual(['sops', 'market', 'activity-log', 'settings']);
    expect(isWorkspaceView('settings')).toBe(true);
    expect(isFullPageWorkspaceView('settings')).toBe(true);
    expect(isWorkspaceView('studio')).toBe(false);
    expect(isFullPageWorkspaceView('office')).toBe(false);
  });

  it('keeps the office scaffold mounted while the employee creator is open', () => {
    expect(shouldShowAppShell('office')).toBe(true);
    expect(shouldShowAppShell('employee-creator')).toBe(true);
    expect(shouldShowAppShell('sops')).toBe(false);
    expect(shouldShowAppShell('market')).toBe(false);
    expect(shouldShowAppShell('activity-log')).toBe(false);
    expect(shouldShowAppShell('settings')).toBe(false);
    expect(shouldShowAppShell('office-editor')).toBe(false);
    expect(shouldShowAppShell('company-select')).toBe(false);
    expect(shouldShowAppShell('studio')).toBe(false);
  });

  it('freezes the office scene while a fullscreen overlay is active', () => {
    expect(isOfficeSceneInteractive('office')).toBe(true);
    expect(isOfficeSceneInteractive('employee-creator')).toBe(false);
    expect(isOfficeSceneInteractive('settings')).toBe(false);
    expect(shouldShowEmployeeCreatorOverlay('employee-creator')).toBe(true);
    expect(shouldShowEmployeeCreatorOverlay('settings')).toBe(false);
    expect(shouldShowEmployeeCreatorOverlay('office')).toBe(false);
  });
});
