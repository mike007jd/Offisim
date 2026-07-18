import { useUiState } from '@/app/ui-state.js';
import { openLoopInOffice } from '@/assistant/composer/open-loop-in-office.js';
import { startLoopAsParallelProjectRun } from '@/assistant/runtime/loop-send-execution.js';
import {
  useArchiveLoop,
  useConfigureLoopSchedule,
  useDuplicateLoop,
  useLoops,
} from '@/data/loops.js';
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
import type { LoopDefinition, LoopScheduleIntervalMinutes } from '@offisim/shared-types';
import {
  Copy,
  Filter,
  MoreHorizontal,
  PlusCircle,
  Repeat,
  Search,
  Send,
  SquareArrowOutUpRight,
  SquarePlay,
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

type StatusFilter = 'all' | 'draft' | 'ready' | 'archived';

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'Any status',
  draft: 'Draft',
  ready: 'Ready',
  archived: 'Archived',
};

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

const SCHEDULE_LABELS: ReadonlyArray<{
  value: 'manual' | `${LoopScheduleIntervalMinutes}`;
  label: string;
}> = [
  { value: 'manual', label: 'Manual only' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '360', label: 'Every 6 hours' },
  { value: '1440', label: 'Every 24 hours' },
];

function scheduleTime(iso: string | undefined): string {
  if (!iso) return '—';
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? '—' : value.toLocaleString();
}

interface LoopLibraryProps {
  onOpenLoop: (loopId: string) => void;
  onNewLoop: () => void;
}

export function LoopLibrary({ onOpenLoop, onNewLoop }: LoopLibraryProps) {
  const companyId = useUiState((s) => s.companyId) || null;
  const loops = useLoops(companyId);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    const rows = loops.data ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((loop) => {
      if (statusFilter !== 'all' && loop.status !== statusFilter) return false;
      if (q && !`${loop.title} ${loop.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [loops.data, query, statusFilter]);

  function handleNewLoop() {
    if (!companyId) return;
    onNewLoop();
  }

  return (
    <div className="off-loops-library">
      <header className="off-loops-head">
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
          <Button size="sm" onClick={handleNewLoop} disabled={!companyId}>
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
            description="A Loop is a reusable playbook for repeatable work. Describe the job once, refine it, and run it whenever you need it."
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
  const configureSchedule = useConfigureLoopSchedule(companyId);
  const projectId = useUiState((s) => s.projectId) || null;
  const [starting, setStarting] = useState(false);
  const status = STATUS_VIEW[loop.status];

  async function handleUse() {
    if (!loop.currentRevisionId) {
      toast.message('Generate and save this plan before using it in Office.');
      return;
    }
    const result = await openLoopInOffice(loop.loopId, loop.currentRevisionId);
    if (result.ok) toast.success('Loop added to Office draft');
  }

  async function handleStartRun() {
    if (!companyId || !projectId || !loop.currentRevisionId) return;
    setStarting(true);
    try {
      await startLoopAsParallelProjectRun({
        loopId: loop.loopId,
        revisionId: loop.currentRevisionId,
        title: loop.title,
        companyId,
        projectId,
      });
      toast.success('Loop run started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the Loop run.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <li className="off-loop-card">
      <button type="button" className="off-loop-card-main off-focusable" onClick={onOpen}>
        <div className="off-loop-card-top">
          <span className="off-loop-card-title">{loop.title}</span>
          <span className={cn('off-loop-card-status', status.tone)}>{status.label}</span>
        </div>
        <p className="off-loop-card-summary">
          {loop.summary || 'Describe this loop to generate its first plan.'}
        </p>
        <div className="off-loop-card-meta">
          <span className="off-loop-card-rev">
            {loop.currentRevisionId
              ? 'Saved plan'
              : loop.summary
                ? 'Description saved · generate the plan next'
                : 'Ready for a description'}
          </span>
          <span className="off-loop-card-time">{timeAgo(loop.updatedAt)}</span>
        </div>
        {loop.currentRevisionId ? (
          <div className="off-loop-card-schedule">
            <span>
              {loop.scheduleIntervalMinutes
                ? `Next ${scheduleTime(loop.nextRunAt)}`
                : 'Run manually'}
            </span>
            {loop.lastRunAt ? (
              <span>
                Last {scheduleTime(loop.lastRunAt)} · {loop.lastRunResult ?? 'completed'}
              </span>
            ) : null}
          </div>
        ) : null}
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
              : 'Generate and save this plan first'
          }
        >
          <Icon icon={Send} size="sm" />
          Use in Office
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleStartRun}
          disabled={!companyId || !projectId || !loop.currentRevisionId || starting}
          title={
            !projectId
              ? 'Select a project first'
              : loop.currentRevisionId
                ? 'Start this Loop as a new project run'
                : 'Generate and save this plan first'
          }
        >
          <Icon icon={SquarePlay} size="sm" />
          Start run
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="More actions">
              <Icon icon={MoreHorizontal} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={loop.scheduleIntervalMinutes ? String(loop.scheduleIntervalMinutes) : 'manual'}
              onValueChange={(value) =>
                configureSchedule.mutate(
                  {
                    loopId: loop.loopId,
                    intervalMinutes:
                      value === 'manual' ? null : (Number(value) as LoopScheduleIntervalMinutes),
                  },
                  {
                    onSuccess: () =>
                      toast.success(
                        value === 'manual' ? 'Loop set to manual' : 'Loop schedule updated',
                      ),
                    onError: (error) =>
                      toast.error(
                        error instanceof Error ? error.message : 'Schedule update failed',
                      ),
                  },
                )
              }
            >
              {SCHEDULE_LABELS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
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
