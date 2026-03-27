import { describe, expect, it } from 'vitest';
import {
  isOfficeSceneInteractive,
  shouldKeepOfficeMounted,
  shouldShowEmployeeCreatorOverlay,
} from './app-view-layout';

describe('app view layout helpers', () => {
  it('keeps the office scaffold mounted while the employee creator is open', () => {
    expect(shouldKeepOfficeMounted('office')).toBe(true);
    expect(shouldKeepOfficeMounted('employee-creator')).toBe(true);
    expect(shouldKeepOfficeMounted('office-editor')).toBe(false);
    expect(shouldKeepOfficeMounted('company-select')).toBe(false);
    expect(shouldKeepOfficeMounted('studio')).toBe(false);
  });

  it('freezes the office scene while a fullscreen overlay is active', () => {
    expect(isOfficeSceneInteractive('office')).toBe(true);
    expect(isOfficeSceneInteractive('employee-creator')).toBe(false);
    expect(shouldShowEmployeeCreatorOverlay('employee-creator')).toBe(true);
    expect(shouldShowEmployeeCreatorOverlay('office')).toBe(false);
  });
});
