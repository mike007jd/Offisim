import { createContext, useContext } from 'react';
import type { EventBus } from '@aics/core';

export interface AicsRuntimeValue {
  eventBus: EventBus;
  isReady: boolean;
  isRunning: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<string | undefined>;
  clearError: () => void;
  /** Re-create runtime from current localStorage config. */
  reinitRuntime: () => void;
}

export const AicsRuntimeContext = createContext<AicsRuntimeValue | null>(null);

export function useAicsRuntime(): AicsRuntimeValue {
  const ctx = useContext(AicsRuntimeContext);
  if (!ctx) throw new Error('useAicsRuntime must be used within <AicsRuntimeProvider>');
  return ctx;
}
