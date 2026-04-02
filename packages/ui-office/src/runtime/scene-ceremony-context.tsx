import { createContext, useContext } from 'react';
import type { CeremonyState } from '../hooks/useSceneOrchestrator';

const SceneCeremonyContext = createContext<CeremonyState | null>(null);

export const SceneCeremonyProvider = SceneCeremonyContext.Provider;

export function useSceneCeremony(): CeremonyState | null {
  return useContext(SceneCeremonyContext);
}
