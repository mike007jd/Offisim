import { type ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Users, LayoutDashboard } from 'lucide-react';

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  sceneCanvas: ReactNode;
  chatDrawer: ReactNode;
  eventLog: ReactNode;
  statusBar: ReactNode;
}

export function AppLayout({
  header,
  agentPanel,
  sceneCanvas,
  chatDrawer,
  eventLog,
  statusBar,
}: AppLayoutProps) {
  const [leftOpen, setLeftOpen] = useState(() => {
    try { return localStorage.getItem('offisim.panel.left') === 'true'; } catch { return false; }
  });
  const [rightOpen, setRightOpen] = useState(() => {
    try { return localStorage.getItem('offisim.panel.right') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('offisim.panel.left', String(leftOpen)); } catch {}
  }, [leftOpen]);
  useEffect(() => {
    try { localStorage.setItem('offisim.panel.right', String(rightOpen)); } catch {}
  }, [rightOpen]);

  return (
    <div className="h-screen bg-[#02040a] text-slate-300 flex flex-col overflow-hidden relative">
      <div className="noise" />
      <div className="scanline" />

      <div className="absolute inset-0 z-0">{sceneCanvas}</div>

      <div className="relative z-50 mx-4 mt-4">{header}</div>

      <div className="flex flex-1 overflow-hidden relative z-10 px-4 pointer-events-none">

        {/* ══════ LEFT PANEL — narrow bar ↔ wide panel ══════ */}
        <div
          className="my-4 border border-white/10 bg-black/40 backdrop-blur-xl rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto shrink-0 flex flex-col transition-all duration-300 ease-out relative"
          style={{ width: leftOpen ? '280px' : '44px' }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

          {leftOpen ? (
            <>
              <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">{agentPanel}</div>
              {/* Collapse handle — vertical center of right edge */}
              <button
                onClick={() => setLeftOpen(false)}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-black/60 border border-white/10 border-r-0 rounded-l-lg px-1 py-4 hover:bg-blue-900/40 transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </>
          ) : (
            /* Collapsed — full-height narrow bar, click to expand */
            <button
              onClick={() => setLeftOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-3 relative z-10 hover:bg-white/5 transition-colors"
            >
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500" style={{ writingMode: 'vertical-rl' }}>
                Personnel
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          )}
        </div>

        <main className="flex-1 min-w-0 pointer-events-none" />

        {/* ══════ RIGHT PANEL — narrow bar ↔ wide panel ══════ */}
        <div
          className="my-4 border border-white/10 bg-black/40 backdrop-blur-xl rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto shrink-0 flex flex-col transition-all duration-300 ease-out relative"
          style={{ width: rightOpen ? '280px' : '44px' }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />

          {rightOpen ? (
            <>
              <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">{eventLog}</div>
              {/* Collapse handle — vertical center of left edge */}
              <button
                onClick={() => setRightOpen(false)}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-black/60 border border-white/10 border-l-0 rounded-r-lg px-1 py-4 hover:bg-blue-900/40 transition-all"
              >
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setRightOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-3 relative z-10 hover:bg-white/5 transition-colors"
            >
              <LayoutDashboard className="w-4 h-4 text-blue-400" />
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-500" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                Operations
              </span>
              <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
            </button>
          )}
        </div>
      </div>

      {/* Chat drawer — floating overlay above status bar, doesn't push layout */}
      <div className="absolute bottom-9 left-4 right-4 z-30 pointer-events-auto">{chatDrawer}</div>
      {/* Status bar — always at bottom */}
      <div className="relative z-30 shrink-0">{statusBar}</div>
    </div>
  );
}
