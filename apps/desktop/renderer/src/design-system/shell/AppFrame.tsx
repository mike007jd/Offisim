import { Icon } from '@/design-system/icons/Icon.js';
import { Activity, BriefcaseBusiness, ChevronDown, LayoutGrid, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  return (
    <main className="off-app">
      <nav className="off-topbar" aria-label="Workspace">
        <div className="off-scope-bar">
          <button type="button" className="off-scope-seg">
            <Icon icon={BriefcaseBusiness} size="sm" />
            Acme Labs
            <Icon icon={ChevronDown} size="sm" />
          </button>
          <span className="off-scope-divider">/</span>
          <button type="button" className="off-scope-seg">
            Project Northstar
            <Icon icon={ChevronDown} size="sm" />
          </button>
        </div>
        <div className="off-workspace-nav">
          <button type="button" className="is-active">
            Office
          </button>
          <button type="button">SOPs</button>
          <button type="button">Market</button>
          <button type="button">Personnel</button>
        </div>
        <div className="off-iconbar">
          <button type="button" aria-label="Activity">
            <Icon icon={Activity} size="sm" />
          </button>
          <button type="button" aria-label="Settings">
            <Icon icon={Settings} size="sm" />
          </button>
          <span className="off-iconbar-divider" aria-hidden />
          <button type="button" aria-label="Studio">
            <Icon icon={LayoutGrid} size="sm" />
          </button>
        </div>
      </nav>
      {children}
    </main>
  );
}
