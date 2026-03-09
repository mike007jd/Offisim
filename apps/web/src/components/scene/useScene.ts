import { useEffect, useRef } from 'react';
import { SceneManager } from '@aics/renderer';
import type { SceneEventBus } from '@aics/renderer';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

export function useScene(reducedMotion = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const { eventBus } = useAicsRuntime();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const manager = new SceneManager({
      container,
      eventBus: eventBus as SceneEventBus,
      reducedMotion,
    });

    managerRef.current = manager;
    manager.mount();

    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [eventBus, reducedMotion]);

  return { containerRef, managerRef };
}
