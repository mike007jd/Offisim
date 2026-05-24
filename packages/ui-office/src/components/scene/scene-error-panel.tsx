import { Alert, AlertDescription, AlertTitle, Button } from '@offisim/ui-core';
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 bg-surface-2 text-xs text-ink-1 hover:bg-surface-sunken"
          onClick={onRetry}
        >
          Retry
        </Button>
      </Alert>
    </div>
  );
}
