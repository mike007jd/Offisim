import { describe, expect, it } from 'vitest';
import {
  FULL_PAGE_WORKSPACE_VIEWS,
  WORKSPACE_VIEWS,
  isFullPageWorkspaceView,
  isWorkspaceView,
  isOfficeSceneInteractive,
  shouldKeepOfficeMounted,
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
    expect(shouldKeepOfficeMounted('office')).toBe(true);
    expect(shouldKeepOfficeMounted('employee-creator')).toBe(true);
    expect(shouldKeepOfficeMounted('sops')).toBe(false);
    expect(shouldKeepOfficeMounted('market')).toBe(false);
    expect(shouldKeepOfficeMounted('activity-log')).toBe(false);
    expect(shouldKeepOfficeMounted('settings')).toBe(false);
    expect(shouldKeepOfficeMounted('office-editor')).toBe(false);
    expect(shouldKeepOfficeMounted('company-select')).toBe(false);
    expect(shouldKeepOfficeMounted('studio')).toBe(false);
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
