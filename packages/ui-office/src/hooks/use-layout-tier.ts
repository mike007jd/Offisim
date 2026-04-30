import { useEffect, useState } from 'react';

export type LayoutTier = 'desktop' | 'tablet' | 'narrow';

export type LayoutTierConfig = {
  tier: LayoutTier;
  leftRailDefault: 'visible' | 'collapsed';
  rightRailDefault: 'visible' | 'collapsed';
  workspaceLayout: 'three-pane' | 'two-pane-collapsible' | 'stacked-navigation';
};

export function computeLayoutTier(viewportWidth: number): LayoutTierConfig {
  if (viewportWidth <= 768) {
    return {
      tier: 'narrow',
      leftRailDefault: 'collapsed',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'stacked-navigation',
    };
  }
  if (viewportWidth <= 1280) {
    return {
      tier: 'tablet',
      leftRailDefault: 'visible',
      rightRailDefault: 'collapsed',
      workspaceLayout: 'two-pane-collapsible',
    };
  }
  return {
    tier: 'desktop',
    leftRailDefault: 'visible',
    rightRailDefault: 'visible',
    workspaceLayout: 'three-pane',
  };
}

function readViewportWidth(): number {
  if (typeof window === 'undefined') return 1920;
  const candidates = [
    window.innerWidth,
    window.visualViewport?.width,
    document.documentElement?.clientWidth,
  ].filter((width): width is number => typeof width === 'number' && Number.isFinite(width));
  return Math.round(Math.min(...candidates));
}

function sameLayoutTierConfig(a: LayoutTierConfig, b: LayoutTierConfig): boolean {
  return (
    a.tier === b.tier &&
    a.leftRailDefault === b.leftRailDefault &&
    a.rightRailDefault === b.rightRailDefault &&
    a.workspaceLayout === b.workspaceLayout
  );
}

export function useLayoutTier(): LayoutTierConfig {
  const [config, setConfig] = useState<LayoutTierConfig>(() =>
    computeLayoutTier(readViewportWidth()),
  );

  useEffect(() => {
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      setConfig((current) => {
        const next = computeLayoutTier(readViewportWidth());
        return sameLayoutTierConfig(current, next) ? current : next;
      });
    };
    const scheduleUpdate = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        update();
      }, 120);
    };
    const mediaQueries = [
      window.matchMedia('(max-width: 768px)'),
      window.matchMedia('(min-width: 769px) and (max-width: 1280px)'),
      window.matchMedia('(min-width: 1281px)'),
    ];
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            scheduleUpdate();
          });

    update();
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);
    for (const query of mediaQueries) query.addEventListener('change', scheduleUpdate);
    resizeObserver?.observe(document.documentElement);

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      for (const query of mediaQueries) query.removeEventListener('change', scheduleUpdate);
      resizeObserver?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, []);

  return config;
}
