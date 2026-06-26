import { useUiState } from '@/app/ui-state.js';
import { openLoopInOffice } from '@/assistant/composer/open-loop-in-office.js';
import { useArchiveLoop, useCreateLoop, useDuplicateLoop, useLoops } from '@/data/loops.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { cn } from '@/lib/utils.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { DEFAULT_COMPILER_PROFILE_ID, listCompilerProfiles } from '@offisim/core/browser';
import type { LoopDefinition } from '@offisim/shared-types';
import {
  Copy,
  Filter,
  MoreHorizontal,
  PlusCircle,
  Repeat,
  Search,
  Send,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * The Loops LIBRARY (PR-08) — reusable Loop definitions as auto-fit cards (no
 * big top-left void). Header: New Loop + search + profile/status filter. Each card
 * shows title/summary/profile/current revision/status/updated, with Open / Use in
 * Office / Duplicate / Archive. Completion is a RUN concept, never a Loop status.
 */

const PROFILE_LABELS: Record<string, string> = Object.fromEntries(
  listCompilerProfiles().map((p) => [p.id, p.displayName]),
);

type StatusFilter = 'all' | 'draft' | 'ready' | 'archived';

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'Any status',
  draft: 'Draft',
  ready: 'Ready',
  archived: 'Archived',
};

function profileLabel(id: string): string {
  return PROFILE_LABELS[id] ?? id;
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface LoopLibraryProps {
  onOpenLoop: (loopId: string) => void;
}

export function LoopLibrary({ onOpenLoop }: LoopLibraryProps) {
  const companyId = useUiState((s) => s.companyId) || null;
  const loops = useLoops(companyId);
  const createLoop = useCreateLoop(companyId);

  const [query, setQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const profiles = useMemo(() => listCompilerProfiles(), []);

  const filtered = useMemo(() => {
    const rows = loops.data ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((loop) => {
      if (profileFilter !== 'all' && loop.profileId !== profileFilter) return false;
      if (statusFilter !== 'all' && loop.status !== statusFilter) return false;
      if (q && !`${loop.title} ${loop.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [loops.data, query, profileFilter, statusFilter]);

  function handleNewLoop() {
    if (!companyId) return;
    createLoop.mutate(
      { title: 'Untitled loop', profileId: DEFAULT_COMPILER_PROFILE_ID },
      {
        onSuccess: (loop) => onOpenLoop(loop.loopId),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not create the Loop.'),
      },
    );
  }

  return (
    <div className="off-loops-library">
      <header className="off-loops-head">
        <div className="off-loops-head-title">
          <Icon icon={Repeat} size="sm" />
          Loops
        </div>
        <div className="off-loops-head-actions">
          <div className="off-loops-search">
            <Search className="off-loops-search-icon" aria-hidden="true" />
            <input
              className="off-input off-loops-search-input"
              placeholder="Search loops…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search loops"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm">
                <Icon icon={Filter} size="sm" />
                {profileFilter === 'all' ? 'All profiles' : profileLabel(profileFilter)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={profileFilter} onValueChange={setProfileFilter}>
                <DropdownMenuRadioItem value="all">All profiles</DropdownMenuRadioItem>
                {profiles.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id}>
                    {p.displayName}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="subtle" size="sm">
                <Icon icon={Filter} size="sm" />
                {statusFilter === 'all' ? 'Any status' : STATUS_FILTER_LABEL[statusFilter]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <DropdownMenuRadioItem value="all">Any status</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="draft">Draft</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ready">Ready</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="archived">Archived</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={handleNewLoop} disabled={!companyId || createLoop.isPending}>
            <Icon icon={PlusCircle} size="sm" />
            New Loop
          </Button>
        </div>
      </header>

      <div className="off-loops-body">
        {loops.isError ? (
          <ErrorState
            title="Couldn't load loops"
            detail={errorDetail(loops.error, 'The loop library failed to load.')}
            onRetry={() => void loops.refetch()}
          />
        ) : loops.isLoading ? (
          <SkeletonRows rows={6} />
        ) : (loops.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No loops yet"
            description="A Loop is a reusable, natural-language design for repeatable work. Describe what you want, enhance it, and compile it into a runnable graph."
            action={companyId ? { label: 'New Loop', onClick: handleNewLoop } : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description="No loops match the current search or filters."
          />
        ) : (
          <ul className="off-loops-grid">
            {filtered.map((loop) => (
              <LoopCard
                key={loop.loopId}
                loop={loop}
                companyId={companyId}
                onOpen={() => onOpenLoop(loop.loopId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const STATUS_VIEW: Record<LoopDefinition['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'is-muted' },
  ready: { label: 'Ready', tone: 'is-ok' },
  archived: { label: 'Archived', tone: 'is-muted' },
};

function LoopCard({
  loop,
  companyId,
  onOpen,
}: {
  loop: LoopDefinition;
  companyId: string | null;
  onOpen: () => void;
}) {
  const duplicate = useDuplicateLoop(companyId);
  const archive = useArchiveLoop(companyId);
  const status = STATUS_VIEW[loop.status];

  async function handleUse() {
    if (!loop.currentRevisionId) {
      toast.message('Compile and save this Loop before using it in Office.');
      return;
    }
    const result = await openLoopInOffice(loop.loopId, loop.currentRevisionId);
    if (result.ok) toast.success('Loop added to Office draft');
  }

  return (
    <li className="off-loop-card">
      <button type="button" className="off-loop-card-main off-focusable" onClick={onOpen}>
        <div className="off-loop-card-top">
          <span className="off-loop-card-title">{loop.title}</span>
          <span className={cn('off-loop-card-status', status.tone)}>{status.label}</span>
        </div>
        <p className="off-loop-card-summary">{loop.summary || 'No description yet.'}</p>
        <div className="off-loop-card-meta">
          <span className="off-loop-card-profile">{profileLabel(loop.profileId)}</span>
          <span className="off-loop-card-dot" aria-hidden="true">
            ·
          </span>
          <span className="off-loop-card-rev">
            {loop.currentRevisionId ? 'Has current revision' : 'Not compiled'}
          </span>
          <span className="off-loop-card-time">{timeAgo(loop.updatedAt)}</span>
        </div>
      </button>
      <div className="off-loop-card-actions">
        <Button variant="subtle" size="sm" onClick={onOpen}>
          <Icon icon={SquareArrowOutUpRight} size="sm" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleUse}
          disabled={!loop.currentRevisionId}
          title={
            loop.currentRevisionId
              ? 'Add this Loop to an Office draft'
              : 'Compile + save this Loop first'
          }
        >
          <Icon icon={Send} size="sm" />
          Use in Office
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="More actions">
              <Icon icon={MoreHorizontal} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                duplicate.mutate(loop, {
                  onSuccess: () => toast.success('Loop duplicated'),
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : 'Duplicate failed'),
                })
              }
            >
              <Copy className="off-menu-icon" />
              Duplicate
            </DropdownMenuItem>
            {loop.status !== 'archived' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    archive.mutate(loop.loopId, {
                      onSuccess: () => toast.success('Loop archived'),
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : 'Archive failed'),
                    })
                  }
                >
                  <Trash2 className="off-menu-icon" />
                  Archive
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
