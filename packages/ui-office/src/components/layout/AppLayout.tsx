import { type ReactNode, useState } from 'react';
import { PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose } from 'lucide-react';

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
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  return (
    <div className="h-screen bg-[#02040a] text-slate-300 flex flex-col overflow-hidden relative">
      <div className="noise" />
      <div className="scanline" />

      {/* Full-screen scene background */}
      <div className="absolute inset-0 z-0">{sceneCanvas}</div>

      {/* Header — floating glass bar */}
      <div className="relative z-50 mx-4 mt-4">{header}</div>

      {/* Main content area with floating panels */}
      <div className="flex flex-1 overflow-hidden relative z-10 px-4 pointer-events-none">
        {/* Left edge tab (when panel closed) */}
        {!leftOpen && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <button
              onClick={() => setLeftOpen(true)}
              className="group flex flex-col items-center justify-center bg-black/60 border border-white/10 border-l-0 py-6 px-1.5 rounded-r-xl backdrop-blur-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] hover:bg-blue-900/40 hover:border-blue-500/40 transition-all"
            >
              <PanelLeftOpen className="w-4 h-4 text-slate-400 group-hover:text-blue-400 mb-3 transition-colors" />
              <span
                className="text-[9px] font-black uppercase tracking-widest text-slate-500 group-hover:text-blue-300 transition-colors"
                style={{ writingMode: 'vertical-rl' }}
              >
                Personnel
              </span>
            </button>
          </div>
        )}

        {/* Left sidebar panel */}
        {leftOpen && (
          <aside className="w-96 border border-white/10 flex flex-col bg-black/40 backdrop-blur-xl rounded-3xl relative shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto shrink-0 z-40 my-4 mr-4">
            <button
              onClick={() => setLeftOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors z-20"
            >
              <PanelLeftClose className="w-4 h-4 text-slate-400" />
            </button>
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
            <div className="h-full overflow-y-auto custom-scrollbar">{agentPanel}</div>
          </aside>
        )}

        {/* Spacer for main content (transparent, lets scene show through) */}
        <main className="flex-1 min-w-0 pointer-events-none" />

        {/* Right edge tab (when panel closed) */}
        {!rightOpen && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <button
              onClick={() => setRightOpen(true)}
              className="group flex flex-col items-center justify-center bg-black/60 border border-white/10 border-r-0 py-6 px-1.5 rounded-l-xl backdrop-blur-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] hover:bg-blue-900/40 hover:border-blue-500/40 transition-all"
            >
              <PanelRightOpen className="w-4 h-4 text-slate-400 group-hover:text-blue-400 mb-3 transition-colors" />
              <span
                className="text-[9px] font-black uppercase tracking-widest text-slate-500 group-hover:text-blue-300 transition-colors"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Operations
              </span>
            </button>
          </div>
        )}

        {/* Right sidebar panel */}
        {rightOpen && (
          <aside className="w-96 border border-white/10 flex flex-col bg-black/40 backdrop-blur-xl rounded-3xl relative shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto shrink-0 z-40 my-4 ml-4">
            <button
              onClick={() => setRightOpen(false)}
              className="absolute top-4 left-4 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors z-20"
            >
              <PanelRightClose className="w-4 h-4 text-slate-400" />
            </button>
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
            <div className="h-full overflow-y-auto custom-scrollbar pt-12">{eventLog}</div>
          </aside>
        )}
      </div>

      {/* Chat drawer — floating glass at bottom */}
      <div className="relative z-30 px-4 pb-2 pointer-events-auto">{chatDrawer}</div>

      {/* Status bar */}
      <div className="relative z-30">{statusBar}</div>
    </div>
  );
}
