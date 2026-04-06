import type { Zone } from '@offisim/shared-types';
import { BookOpen, Database } from 'lucide-react';
import type { ReactNode } from 'react';
import { EventLog, Library, MarketplacePanel, ServerRoom, SopPanel } from '@offisim/ui-office';
import {
  hasWorkspaceSurfaceZone,
  type WorkspaceSurfaceView,
} from './workspace-surface-meta';

interface WorkspaceSurfaceProps {
  view: WorkspaceSurfaceView;
  zones: Zone[];
  activeThreadId: string | null;
  onOpenListing: (listingId: string) => void;
  onStartInstall: (listingId: string, version: string) => void;
}

function SurfaceShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full w-full items-start justify-center px-6 py-24">
      <div className="pointer-events-auto w-full max-w-5xl rounded-3xl border border-white/10 bg-black/55 p-4 shadow-2xl backdrop-blur-xl">
        <div className="mb-4 border-b border-white/8 px-2 pb-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{eyebrow}</div>
          <div className="mt-1 text-lg font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm text-slate-400">{description}</div>
        </div>
        <div className="h-[calc(100vh-14rem)] min-h-[28rem] overflow-hidden rounded-2xl border border-white/8 bg-black/20">
          {children}
        </div>
      </div>
    </div>
  );
}

function EmptySpaceState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof BookOpen;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      <div className="text-sm font-semibold text-slate-200">{title}</div>
      <div className="max-w-md text-xs leading-relaxed text-slate-500">{body}</div>
    </div>
  );
}

export function WorkspaceSurface({
  view,
  zones,
  activeThreadId,
  onOpenListing,
  onStartInstall,
}: WorkspaceSurfaceProps) {
  if (view === 'sops') {
    return (
      <SurfaceShell
        eyebrow="Workspace"
        title="SOPs"
        description="Build, inspect, and run reusable procedures outside the right collaboration rail."
      >
        <div className="h-full overflow-y-auto">
          <SopPanel />
        </div>
      </SurfaceShell>
    );
  }

  if (view === 'market') {
    return (
      <SurfaceShell
        eyebrow="Ecosystem"
        title="Market"
        description="Browse and publish packages without burying the ecosystem under collaboration tabs."
      >
        <MarketplacePanel onOpenListing={onOpenListing} onStartInstall={onStartInstall} />
      </SurfaceShell>
    );
  }

  if (view === 'activity-log') {
    return (
      <SurfaceShell
        eyebrow="History"
        title="Activity Log"
        description="Inspect the full runtime timeline without turning notifications into a junk drawer."
      >
        <div className="h-full overflow-y-auto p-2">
          <EventLog />
        </div>
      </SurfaceShell>
    );
  }

  if (view === 'library') {
    return (
      <SurfaceShell
        eyebrow="Office Space"
        title="Library"
        description="Reference material belongs to the office environment, not a permanent global sidebar tab."
      >
        {hasWorkspaceSurfaceZone(view, zones) ? (
          <div className="h-full overflow-y-auto p-2">
            <Library />
          </div>
        ) : (
          <EmptySpaceState
            icon={BookOpen}
            title="No library zone in this office"
            body="Add or restore a library zone in Studio before treating the library as an active space."
          />
        )}
      </SurfaceShell>
    );
  }

  return (
    <SurfaceShell
      eyebrow="Office Space"
      title="Server Room"
      description="Infrastructure should read like part of the workplace, not a permanent tab beside chat."
    >
      {hasWorkspaceSurfaceZone(view, zones) ? (
        <div className="h-full overflow-y-auto p-3">
          <ServerRoom activeThreadId={activeThreadId} />
        </div>
      ) : (
        <EmptySpaceState
          icon={Database}
          title="No server room zone in this office"
          body="Create a server zone in Studio before exposing infrastructure as an active office space."
        />
      )}
    </SurfaceShell>
  );
}
