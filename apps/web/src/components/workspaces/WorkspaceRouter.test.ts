import { describe, expect, it } from 'vitest';

import type { WorkspaceKey } from './types';
import {
  shouldMountOfficeScene,
  isOfficeSceneInteractive,
  type TransitionState,
} from './WorkspaceRouter';

// ---------------------------------------------------------------------------
// All workspace keys and transition states for exhaustive testing
// ---------------------------------------------------------------------------

const ALL_WORKSPACES: WorkspaceKey[] = ['office', 'sops', 'market', 'activity-log', 'settings'];
const ALL_TRANSITIONS: TransitionState[] = ['idle', 'animating-out', 'animating-in'];

// ---------------------------------------------------------------------------
// shouldMountOfficeScene
// ---------------------------------------------------------------------------

describe('shouldMountOfficeScene', () => {
  it('returns true when activeWorkspace is office (any transition)', () => {
    for (const t of ALL_TRANSITIONS) {
      expect(shouldMountOfficeScene('office', t)).toBe(true);
    }
  });

  it('returns true during animating-out for non-office workspaces', () => {
    for (const ws of ALL_WORKSPACES.filter((w) => w !== 'office')) {
      expect(shouldMountOfficeScene(ws, 'animating-out')).toBe(true);
    }
  });

  it('returns false for non-office workspaces when idle', () => {
    for (const ws of ALL_WORKSPACES.filter((w) => w !== 'office')) {
      expect(shouldMountOfficeScene(ws, 'idle')).toBe(false);
    }
  });

  it('returns false for non-office workspaces when animating-in', () => {
    for (const ws of ALL_WORKSPACES.filter((w) => w !== 'office')) {
      expect(shouldMountOfficeScene(ws, 'animating-in')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// isOfficeSceneInteractive
// ---------------------------------------------------------------------------

describe('isOfficeSceneInteractive', () => {
  it('returns true only when office + idle', () => {
    expect(isOfficeSceneInteractive('office', 'idle')).toBe(true);
  });

  it('returns false when office but animating-out', () => {
    expect(isOfficeSceneInteractive('office', 'animating-out')).toBe(false);
  });

  it('returns false when office but animating-in', () => {
    expect(isOfficeSceneInteractive('office', 'animating-in')).toBe(false);
  });

  it('returns false for all non-office workspaces regardless of transition', () => {
    for (const ws of ALL_WORKSPACES.filter((w) => w !== 'office')) {
      for (const t of ALL_TRANSITIONS) {
        expect(isOfficeSceneInteractive(ws, t)).toBe(false);
      }
    }
  });
});
