import { type MutableRefObject, useRef } from 'react';

export interface CeremonyEventCoordination {
  hasActivePlanRef: MutableRefObject<boolean>;
  lastLlmChunkRef: MutableRefObject<string>;
}

export function useCeremonyEventCoordination(): CeremonyEventCoordination {
  const hasActivePlanRef = useRef(false);
  const lastLlmChunkRef = useRef('');
  return { hasActivePlanRef, lastLlmChunkRef };
}
