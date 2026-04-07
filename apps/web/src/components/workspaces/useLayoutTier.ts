import { useCallback, useEffect, useState } from 'react';

import { computeLayoutTier, type LayoutTierConfig } from './types';

/**
 * Reactively computes the current responsive layout tier based on
 * `window.innerWidth`. Resize events are debounced (100 ms) to avoid
 * excessive re-renders during drag-resize.
 */
export function useLayoutTier(): LayoutTierConfig {
  const [config, setConfig] = useState<LayoutTierConfig>(() =>
    computeLayoutTier(typeof window !== 'undefined' ? window.innerWidth : 1920),
  );

  const update = useCallback(() => {
    setConfig(computeLayoutTier(window.innerWidth));
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onResize = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        update();
      }, 100);
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer !== null) clearTimeout(timer);
    };
  }, [update]);

  return config;
}
