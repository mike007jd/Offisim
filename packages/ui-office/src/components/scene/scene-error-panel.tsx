import { Alert, AlertDescription, AlertTitle } from '@offisim/ui-core';
import { useSceneColors } from '../../theme/use-scene-colors.js';

interface SceneErrorPanelProps {
  error: string;
  onRetry: () => void;
}

export function SceneErrorPanel({ error, onRetry }: SceneErrorPanelProps) {
  const sceneColors = useSceneColors();
  return (
    <div
      className="flex h-full w-full items-center justify-center p-6"
      style={{ backgroundColor: sceneColors.sceneBackground }}
    >
      <Alert variant="destructive" className="max-w-sm text-center">
        <AlertTitle>Scene Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <button
          type="button"
          className="mt-3 rounded bg-surface-muted px-3 py-1 text-xs text-text-primary transition-colors hover:bg-surface-hover"
          onClick={onRetry}
        >
          Retry
        </button>
      </Alert>
    </div>
  );
}
