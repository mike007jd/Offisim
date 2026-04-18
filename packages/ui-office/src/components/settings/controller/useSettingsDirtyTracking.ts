import { useCallback, useEffect, useRef, useState } from 'react';

interface DirtyTrackingOptions {
  isActive: boolean;
  snapshotJson: string;
  onDismiss: () => void;
}

export function useSettingsDirtyTracking({
  isActive,
  snapshotJson,
  onDismiss,
}: DirtyTrackingOptions) {
  const loadedSnapshotRef = useRef<string | null>(null);
  const [captureVersion, setCaptureVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: capture is driven by the captureVersion counter, which the orchestrator bumps via markLoaded() in its load-tail — same React batch as applyFromSaved. Keying on [captureVersion] (not [snapshotJson]) guarantees the effect reads the post-commit LOADED snapshot from closure; adding snapshotJson would re-introduce the StrictMode double-invoke race this change fixes.
  useEffect(() => {
    if (captureVersion === 0) return;
    loadedSnapshotRef.current = snapshotJson;
  }, [captureVersion]);

  const hasUnsavedChanges =
    isActive && loadedSnapshotRef.current !== null && snapshotJson !== loadedSnapshotRef.current;

  const requestDismiss = useCallback(() => {
    if (
      hasUnsavedChanges &&
      typeof window !== 'undefined' &&
      !window.confirm('Discard unsaved changes in Settings?')
    ) {
      return;
    }
    onDismiss();
  }, [hasUnsavedChanges, onDismiss]);

  const markLoaded = useCallback(() => setCaptureVersion((v) => v + 1), []);

  const resetLoadedSnapshot = useCallback((snapshot: string) => {
    loadedSnapshotRef.current = snapshot;
  }, []);

  return {
    hasUnsavedChanges,
    requestDismiss,
    markLoaded,
    resetLoadedSnapshot,
  };
}
