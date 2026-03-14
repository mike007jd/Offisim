import { SceneManager } from '@aics/renderer';
import type { SceneEventBus } from '@aics/renderer';
import { useEffect, useRef, useState } from 'react';
import { COMPANY_ID } from '../../lib/constants';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

export function useScene(reducedMotion = false) {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<SceneManager | null>(null);
  const { eventBus, repos } = useAicsRuntime();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

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
      // Start with no employees — real employees are loaded from repos in a
      // separate useEffect (avoids hardcoded DEFAULT_EMPLOYEES).
      employees: [],
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
              employeeDebugInfo: manager.employeeDebugInfo,
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

  // Listen for scene-initiated selection events and sync to React state.
  // This is the scene→DOM direction of the bidirectional sync bridge.
  useEffect(() => {
    if (!eventBus) return;
    const unsub = (eventBus as SceneEventBus).on('ui.selection.changed', (event) => {
      const payload = event.payload as { entityId: string | null; source: string };
      if (payload.source === 'scene') {
        setSelectedEmployeeId(payload.entityId);
      }
    });
    return unsub;
  }, [eventBus]);

  // Populate scene with real employees from repos.
  // When repos identity changes (reinitRuntime → new repos), clear old employees
  // and re-populate from the new repos. SceneManager already subscribes to
  // employee.created events for live additions, but the initial load from DB
  // happens here.
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager || !repos) return;

    let cancelled = false;

    // Clear any existing employees from a previous runtime (reinit scenario).
    // Uses the public removeEmployee() API — no new SceneManager method needed.
    for (const id of manager.employeeIds) {
      manager.removeEmployee(id);
    }

    // Load employees from the current repos
    repos.employees.findByCompany(COMPANY_ID).then((rows) => {
      if (cancelled) return;
      for (const row of rows) {
        // Extract characterConfig from persona_json if present
        let characterConfig: Record<string, unknown> | undefined;
        if (row.persona_json) {
          try {
            const persona = JSON.parse(row.persona_json);
            if (persona.characterConfig) {
              characterConfig = persona.characterConfig;
            }
          } catch {
            /* ignore parse errors */
          }
        }
        manager.addEmployee(
          row.employee_id,
          row.name,
          'employee',
          row.role_slug ?? undefined,
          characterConfig as import('@aics/renderer').CharacterConfig | undefined,
        );
      }
      // Recompute floor plan now that all employees are loaded — zone sizes
      // are based on actual department counts instead of the empty initial set.
      if (rows.length > 0) {
        manager.rebuildLayout();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repos]);

  return { containerRef, managerRef, selectedEmployeeId };
}
