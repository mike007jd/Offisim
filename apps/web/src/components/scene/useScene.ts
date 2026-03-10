import { SceneManager } from '@aics/renderer';
import type { SceneEventBus } from '@aics/renderer';
import { useEffect, useRef } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

export function useScene(reducedMotion = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const { eventBus } = useAicsRuntime();

  // Create / destroy SceneManager when eventBus changes.
  // reducedMotion is NOT in the dep array — we update it via setter (I3).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reducedMotion excluded — updated via setter to avoid rebuilding SceneManager
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const manager = new SceneManager({
      container,
      // SceneEventBus is a structural subset of EventBus (only needs `on`).
      // The cast is safe because core's EventBus.on signature is compatible (I2).
      eventBus: eventBus as SceneEventBus,
      reducedMotion,
    });

    managerRef.current = manager;

    // Await mount — handle errors and guard against unmount-before-init (I1)
    manager
      .mount()
      .then(() => {
        if (!cancelled) {
          // Wire SceneManager into debug bridge (dev mode only, for E2E smoke tests)
          if (import.meta.env.DEV && window.__AICS_DEBUG__) {
            window.__AICS_DEBUG__.getSceneState = () => ({
              employeeCount: manager.employeeCount,
              employeeIds: manager.employeeIds,
            });
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[SceneManager] mount failed:', err);
        }
      });

    return () => {
      cancelled = true;
      manager.destroy();
      managerRef.current = null;
      // Reset debug bridge scene accessor to dummy (scene is unmounted)
      if (import.meta.env.DEV && window.__AICS_DEBUG__) {
        window.__AICS_DEBUG__.getSceneState = () => ({
          employeeCount: 0,
          employeeIds: [],
        });
      }
    };
  }, [eventBus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update reduced-motion via setter without rebuilding the scene (I3)
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.reducedMotion = reducedMotion;
    }
  }, [reducedMotion]);

  return { containerRef, managerRef };
}
