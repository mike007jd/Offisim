import { useCallback, useEffect, useRef } from 'react';

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
  const loadedSnapshotRef = useRef('');
  const pendingSnapshotCaptureRef = useRef(false);

  useEffect(() => {
    if (pendingSnapshotCaptureRef.current) {
      loadedSnapshotRef.current = snapshotJson;
      pendingSnapshotCaptureRef.current = false;
    }
  }, [snapshotJson]);

  const hasUnsavedChanges =
    isActive && loadedSnapshotRef.current !== '' && snapshotJson !== loadedSnapshotRef.current;

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

  const queueCapture = useCallback(() => {
    pendingSnapshotCaptureRef.current = true;
  }, []);

  const resetLoadedSnapshot = useCallback((snapshot: string) => {
    loadedSnapshotRef.current = snapshot;
  }, []);

  return {
    hasUnsavedChanges,
    requestDismiss,
    queueCapture,
    resetLoadedSnapshot,
  };
}
