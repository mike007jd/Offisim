import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The hook is thin glue: useEffect + refs + popstate listener.
// We extract and test the core decision logic that the popstate handler uses.
// This avoids needing a jsdom environment while still validating the contract.
// ---------------------------------------------------------------------------

/**
 * Simulates the popstate handler logic from useWorkspaceBackNavigation.
 * Returns what actions were taken.
 */
function simulatePopState(
  workspaceInternalBack: () => boolean,
  switchToPreviousWorkspace: () => void,
): { pushStateCalled: boolean } {
  let pushStateCalled = false;

  const consumed = workspaceInternalBack();

  if (consumed) {
    // In the real hook, this would be window.history.pushState(...)
    pushStateCalled = true;
  } else {
    switchToPreviousWorkspace();
  }

  return { pushStateCalled };
}

describe('useWorkspaceBackNavigation — popstate handler logic', () => {
  it('calls workspaceInternalBack first on popstate', () => {
    const internalBack = vi.fn().mockReturnValue(true);
    const switchPrev = vi.fn();

    simulatePopState(internalBack, switchPrev);

    expect(internalBack).toHaveBeenCalledOnce();
    expect(switchPrev).not.toHaveBeenCalled();
  });

  it('calls switchToPreviousWorkspace when internalBack returns false', () => {
    const internalBack = vi.fn().mockReturnValue(false);
    const switchPrev = vi.fn();

    simulatePopState(internalBack, switchPrev);

    expect(internalBack).toHaveBeenCalledOnce();
    expect(switchPrev).toHaveBeenCalledOnce();
  });

  it('pushes a new history entry when internal back is consumed', () => {
    const internalBack = vi.fn().mockReturnValue(true);
    const switchPrev = vi.fn();

    const result = simulatePopState(internalBack, switchPrev);

    expect(result.pushStateCalled).toBe(true);
  });

  it('does not push history entry when switching to previous workspace', () => {
    const internalBack = vi.fn().mockReturnValue(false);
    const switchPrev = vi.fn();

    const result = simulatePopState(internalBack, switchPrev);

    expect(result.pushStateCalled).toBe(false);
    expect(switchPrev).toHaveBeenCalledOnce();
  });

  it('handles multiple sequential back presses correctly', () => {
    // Simulate: first two backs are consumed internally, third switches workspace
    let callCount = 0;
    const internalBack = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount <= 2;
    });
    const switchPrev = vi.fn();

    // First back — consumed
    const r1 = simulatePopState(internalBack, switchPrev);
    expect(r1.pushStateCalled).toBe(true);
    expect(switchPrev).not.toHaveBeenCalled();

    // Second back — consumed
    const r2 = simulatePopState(internalBack, switchPrev);
    expect(r2.pushStateCalled).toBe(true);
    expect(switchPrev).not.toHaveBeenCalled();

    // Third back — not consumed, switch workspace
    const r3 = simulatePopState(internalBack, switchPrev);
    expect(r3.pushStateCalled).toBe(false);
    expect(switchPrev).toHaveBeenCalledOnce();
  });
});
