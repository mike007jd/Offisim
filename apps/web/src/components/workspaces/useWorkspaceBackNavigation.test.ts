import { describe, expect, it, vi } from 'vitest';
import { handleWorkspacePopState } from './useWorkspaceBackNavigation';

describe('useWorkspaceBackNavigation — popstate handler logic', () => {
  it('always delegates to goBack first', () => {
    const goBack = vi.fn().mockReturnValue('internal');
    const restoreHistoryEntry = vi.fn();

    handleWorkspacePopState(goBack, restoreHistoryEntry);

    expect(goBack).toHaveBeenCalledOnce();
  });

  it('restores the current history entry when back is consumed internally', () => {
    const goBack = vi.fn().mockReturnValue('internal');
    const restoreHistoryEntry = vi.fn();

    handleWorkspacePopState(goBack, restoreHistoryEntry);

    expect(restoreHistoryEntry).toHaveBeenCalledOnce();
  });

  it('does not restore the history entry when switching to a previous workspace', () => {
    const goBack = vi.fn().mockReturnValue('workspace');
    const restoreHistoryEntry = vi.fn();

    handleWorkspacePopState(goBack, restoreHistoryEntry);

    expect(restoreHistoryEntry).not.toHaveBeenCalled();
  });

  it('does not restore the history entry when there is nothing left to unwind', () => {
    const goBack = vi.fn().mockReturnValue('none');
    const restoreHistoryEntry = vi.fn();

    handleWorkspacePopState(goBack, restoreHistoryEntry);

    expect(restoreHistoryEntry).not.toHaveBeenCalled();
  });

  it('restores history only for internally consumed backs across a sequence', () => {
    const outcomes: Array<'internal' | 'workspace' | 'none'> = [
      'internal',
      'internal',
      'workspace',
      'none',
    ];
    const goBack = vi.fn().mockImplementation(() => outcomes.shift() ?? 'none');
    const restoreHistoryEntry = vi.fn();

    handleWorkspacePopState(goBack, restoreHistoryEntry);
    handleWorkspacePopState(goBack, restoreHistoryEntry);
    handleWorkspacePopState(goBack, restoreHistoryEntry);
    handleWorkspacePopState(goBack, restoreHistoryEntry);

    expect(restoreHistoryEntry).toHaveBeenCalledTimes(2);
  });
});
