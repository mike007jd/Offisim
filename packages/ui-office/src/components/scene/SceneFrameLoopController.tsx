import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

export interface OrbitControlsHandleLike {
  addEventListener: (event: 'change', handler: () => void) => void;
  removeEventListener: (event: 'change', handler: () => void) => void;
}

interface SceneFrameLoopControllerProps {
  animate: boolean;
  controlsRef: React.RefObject<OrbitControlsHandleLike | null>;
}

/**
 * Keeps demand-mode canvases responsive to camera interactions and
 * forces a single refresh whenever the animation mode changes.
 */
export function SceneFrameLoopController({
  animate,
  controlsRef,
}: SceneFrameLoopControllerProps) {
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [animate, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const handleChange = () => invalidate();
    controls.addEventListener('change', handleChange);
    return () => {
      controls.removeEventListener('change', handleChange);
    };
  }, [controlsRef, invalidate]);

  return null;
}
