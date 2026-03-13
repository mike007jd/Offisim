import { useScene } from './useScene';

interface SceneCanvasProps {
  reducedMotion?: boolean;
}

export function SceneCanvas({ reducedMotion = false }: SceneCanvasProps) {
  const { containerRef } = useScene(reducedMotion);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-ocean-deep" />;
}
