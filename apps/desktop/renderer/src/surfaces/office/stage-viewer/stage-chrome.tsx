import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';

export interface StageChrome {
  title?: string;
  meta?: string;
  badge?: string;
  actions?: ReactNode;
}

interface StageChromeContextValue {
  chrome: StageChrome | null;
  setChrome: (chrome: StageChrome | null) => void;
}

const StageChromeContext = createContext<StageChromeContextValue | null>(null);

const noopSetChrome = () => {};

export function StageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<StageChrome | null>(null);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <StageChromeContext.Provider value={value}>{children}</StageChromeContext.Provider>;
}

export function useStageChrome(): StageChrome | null {
  return useContext(StageChromeContext)?.chrome ?? null;
}

export function useSetStageChrome(): (chrome: StageChrome | null) => void {
  return useContext(StageChromeContext)?.setChrome ?? noopSetChrome;
}
