import type { EventBus } from '@aics/core';
import type { InstallService } from '@aics/install-core';
import { createContext, useContext } from 'react';

export interface AicsRuntimeValue {
  eventBus: EventBus;
  isReady: boolean;
  isRunning: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<string | undefined>;
  clearError: () => void;
  /** Re-create runtime from current localStorage config. */
  reinitRuntime: () => void;
  /** Install service — null in Tauri mode or when runtime is not yet ready. */
  installService: InstallService | null;
}

export const AicsRuntimeContext = createContext<AicsRuntimeValue | null>(null);

export function useAicsRuntime(): AicsRuntimeValue {
  const ctx = useContext(AicsRuntimeContext);
  if (!ctx) throw new Error('useAicsRuntime must be used within <AicsRuntimeProvider>');
  return ctx;
}
