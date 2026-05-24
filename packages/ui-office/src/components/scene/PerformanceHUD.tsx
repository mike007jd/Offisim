import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'offisim.perf.hud';

interface PerfStats {
  fps: number;
  frameMs: number;
  heapMB: number | null;
}

export function PerformanceHUD() {
  if (!import.meta.env.DEV) return null;
  return <PerformanceHUDInner />;
}

function PerformanceHUDInner() {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [stats, setStats] = useState<PerfStats>({ fps: 0, frameMs: 0, heapMB: null });

  // Toggle with F2
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') {
        setVisible((v) => {
          const next = !v;
          try {
            localStorage.setItem(STORAGE_KEY, String(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // rAF loop — only runs when visible
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!visible) return;

    let prevFrameTime = performance.now();

    function loop() {
      const now = performance.now();
      const frameMs = now - prevFrameTime;
      prevFrameTime = now;
      frameCountRef.current += 1;

      const elapsed = now - lastTimeRef.current;
      if (elapsed >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        frameCountRef.current = 0;
        lastTimeRef.current = now;

        let heapMB: number | null = null;
        const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
        if (mem) {
          heapMB = Math.round(mem.usedJSHeapSize / 1048576);
        }

        setStats({ fps, frameMs: Math.round(frameMs * 10) / 10, heapMB });
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute left-sp-sm top-sp-sm z-40 select-none"
      aria-hidden="true"
    >
      <div className="rounded-r-sm bg-ink-1/80 px-sp-sm py-sp-xs font-mono text-fs-micro leading-relaxed text-success">
        <div>FPS&nbsp;&nbsp;&nbsp;{stats.fps.toString().padStart(4, '\u00a0')}</div>
        <div>FRAME&nbsp;{stats.frameMs.toFixed(1).padStart(6, '\u00a0')} ms</div>
        {stats.heapMB !== null && (
          <div>HEAP&nbsp;&nbsp;{stats.heapMB.toString().padStart(5, '\u00a0')} MB</div>
        )}
        <div className="mt-sp-xs text-success/70">F2 toggle</div>
      </div>
    </div>
  );
}
