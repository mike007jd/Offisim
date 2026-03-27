import { getConsoleFunction, setConsoleFunction } from 'three';

const THREE_CLOCK_DEPRECATION =
  'Clock: This module has been deprecated. Please use THREE.Timer instead.';

type ThreeConsoleLevel = 'log' | 'warn' | 'error';
type ThreeConsoleHandler = (level: ThreeConsoleLevel, message: string, ...params: unknown[]) => void;

function fallbackConsole(level: ThreeConsoleLevel, message: string, ...params: unknown[]) {
  if (level === 'warn') {
    console.warn(message, ...params);
    return;
  }
  if (level === 'error') {
    console.error(message, ...params);
    return;
  }
  console.log(message, ...params);
}

export function shouldSuppressThreeConsoleMessage(level: ThreeConsoleLevel, message: string): boolean {
  return import.meta.env.DEV && level === 'warn' && message.endsWith(THREE_CLOCK_DEPRECATION);
}

export function installThreeConsoleFilter() {
  if (!import.meta.env.DEV) return;

  const currentHandler = getConsoleFunction() as ThreeConsoleHandler | null;
  if ((currentHandler as ThreeConsoleHandler & { __aicsInstalled?: boolean })?.__aicsInstalled) {
    return;
  }

  const filteredHandler = ((level: ThreeConsoleLevel, message: string, ...params: unknown[]) => {
    if (shouldSuppressThreeConsoleMessage(level, message)) {
      return;
    }

    if (currentHandler) {
      currentHandler(level, message, ...params);
      return;
    }

    fallbackConsole(level, message, ...params);
  }) as ThreeConsoleHandler & { __aicsInstalled?: boolean };

  filteredHandler.__aicsInstalled = true;
  setConsoleFunction(filteredHandler);
}
