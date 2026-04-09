import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface WorkspacePageHeaderProps {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
}

export function WorkspacePageHeader({ title, onBack, actions }: WorkspacePageHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between rounded-[18px] border border-white/10 bg-black/20 px-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Office
        </button>
        <div className="h-5 w-px bg-white/10" />
        <h1 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
