import type { InMemoryEventBus } from '@offisim/core/browser';
import { InMemorySceneIntentBus, SceneIntentDispatcher } from '@offisim/ui-office/web';
import { useEffect, useRef } from 'react';

export function useSceneIntentWiring({
  eventBus,
}: {
  eventBus: InMemoryEventBus;
}): { sceneIntentBus: InMemorySceneIntentBus } {
  const sceneIntentBusRef = useRef(new InMemorySceneIntentBus());

  useEffect(() => {
    const sceneIntentBus = sceneIntentBusRef.current;
    const dispatcher = new SceneIntentDispatcher(eventBus, sceneIntentBus);
    dispatcher.activate();
    return () => {
      dispatcher.deactivate();
      sceneIntentBus.removeAll();
    };
  }, [eventBus]);

  return { sceneIntentBus: sceneIntentBusRef.current };
}
