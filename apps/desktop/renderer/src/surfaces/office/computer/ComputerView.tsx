import { useUiState } from '@/app/ui-state.js';
import { PermissionApprovalBar } from '@/assistant/parts/PermissionApprovalBar.js';
import {
  type ConversationRunSnapshot,
  conversationRunController,
} from '@/assistant/runtime/conversation-run-controller.js';
import {
  isConversationRunActive,
  useActiveConversationRuns,
} from '@/assistant/runtime/conversation-run-react.js';
import { useDeliverables, useEmployees } from '@/data/queries.js';
import type { Deliverable } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ToolRichDetail } from '@offisim/shared-types';
import {
  Camera,
  Download,
  FileText,
  Keyboard,
  MonitorSmartphone,
  MousePointerClick,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type RunActivity = ConversationRunSnapshot['activity'][number];
type ComputerDetail = Extract<ToolRichDetail, { family: 'computer' }>;
type ComputerActivity = RunActivity & { richDetail: ComputerDetail };

interface LocalExportResult {
  path: string;
  displayPath: string;
  fileName: string;
  sizeBytes: number;
  size: string;
}

function isComputerActivity(entry: RunActivity): entry is ComputerActivity {
  return entry.richDetail?.family === 'computer';
}

function computerEntries(run: ConversationRunSnapshot | null): ComputerActivity[] {
  return run ? run.activity.filter(isComputerActivity) : [];
}

function hasComputerActivity(run: ConversationRunSnapshot): boolean {
  return run.activity.some(isComputerActivity);
}

function pickRun(
  runs: readonly ConversationRunSnapshot[],
  activeRuns: readonly ConversationRunSnapshot[],
  requestedThreadId: string | null,
): ConversationRunSnapshot | null {
  if (requestedThreadId) {
    const requested = runs.find((run) => run.threadId === requestedThreadId);
    if (requested) return requested;
  }
  return (
    [...activeRuns].reverse().find(hasComputerActivity) ??
    [...runs].reverse().find(hasComputerActivity) ??
    activeRuns[0] ??
    null
  );
}

function latestComputerDetail(entries: readonly ComputerActivity[]): ComputerDetail | null {
  return entries[entries.length - 1]?.richDetail ?? null;
}

function latestScreenshot(
  entries: readonly ComputerActivity[],
): ComputerDetail['screenshot'] | null {
  return (
    [...entries].reverse().find((entry) => entry.richDetail.screenshot)?.richDetail.screenshot ??
    null
  );
}

function imageSrc(dataRef: string | undefined): string | null {
  if (!dataRef) return null;
  return /^(data:|blob:|https?:)/i.test(dataRef) ? dataRef : null;
}

function actionIcon(action: ComputerDetail['action']) {
  if (action === 'click' || action === 'drag' || action === 'move') return MousePointerClick;
  if (action === 'type' || action === 'key') return Keyboard;
  if (action === 'screenshot' || action === 'observe') return Camera;
  return MonitorSmartphone;
}

function fileLeaf(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function uniqueArtifactPaths(entries: readonly ComputerActivity[]) {
  return Array.from(
    new Set(entries.flatMap((entry) => entry.richDetail.artifactPaths ?? []).filter(Boolean)),
  );
}

export function ComputerView({ threadId }: { threadId?: string | null }) {
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openStageView = useUiState((s) => s.openStageView);
  const setSurface = useUiState((s) => s.setSurface);
  const runsSnapshot = useActiveConversationRuns();
  const requestedThreadId = threadId ?? selectedThreadId;
  const run = pickRun(runsSnapshot.runs, runsSnapshot.activeRuns, requestedThreadId);
  const entries = useMemo(() => computerEntries(run), [run]);
  const runId = run?.attemptId ?? run?.threadId ?? null;
  const active = run ? isConversationRunActive(run.phase) : false;
  const latest = latestComputerDetail(entries);
  const shot = latestScreenshot(entries);
  const shotSrc = imageSrc(shot?.dataRef);
  const artifactPaths = useMemo(() => uniqueArtifactPaths(entries), [entries]);
  const deliverablesQuery = useDeliverables(run?.threadId ?? null);
  const deliverables = deliverablesQuery.data ?? [];
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const employeesQuery = useEmployees();
  const employeeName = run?.employeeId
    ? (employeesQuery.data?.find((employee) => employee.id === run.employeeId)?.name ??
      run.employeeId)
    : null;
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => timelineRef.current,
    // 48px row + 6px gap between cards.
    estimateSize: () => 54,
    overscan: 6,
  });

  useEffect(() => {
    const fallback = entries[entries.length - 1]?.id ?? null;
    if (!fallback) {
      setSelectedActivityId(null);
      return;
    }
    if (!selectedActivityId || !entries.some((entry) => entry.id === selectedActivityId)) {
      setSelectedActivityId(fallback);
    }
  }, [entries, selectedActivityId]);

  const selectedEntry =
    entries.find((entry) => entry.id === selectedActivityId) ?? entries[entries.length - 1] ?? null;

  function openDeliverable(deliverable: Deliverable) {
    openStageView({
      kind: 'preview',
      ref: {
        source: 'deliverable',
        deliverableId: deliverable.id,
        threadId: deliverable.threadId ?? run?.threadId ?? null,
        format: deliverable.format,
        name: deliverable.name,
      },
      title: deliverable.name,
    });
  }

  function openArtifactPath(path: string) {
    openStageView({
      kind: 'preview',
      ref: { source: 'computer-artifact', path, runId: runId ?? undefined },
      title: fileLeaf(path),
    });
  }

  async function exportTrace() {
    if (!run || entries.length === 0) return;
    setExporting(true);
    try {
      const trace = {
        threadId: run.threadId,
        runId,
        phase: run.phase,
        employeeId: run.employeeId,
        exportedAt: new Date().toISOString(),
        entries: entries.map((entry) => ({
          id: entry.id,
          tool: entry.tool,
          state: entry.state,
          durationMs: entry.durationMs ?? null,
          detail: entry.detail ?? null,
          computer: entry.richDetail,
        })),
        artifactPaths,
        deliverables: deliverables.map((deliverable) => ({
          id: deliverable.id,
          name: deliverable.name,
          kind: deliverable.kind,
          mimeType: deliverable.mimeType ?? null,
          format: deliverable.format ?? null,
        })),
      };
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<LocalExportResult>('export_computer_run_trace', {
        threadId: run.threadId,
        runId: runId ?? run.threadId,
        traceJson: JSON.stringify(trace),
      });
      toast.success('Exported computer trace', { description: result.displayPath ?? result.path });
    } catch (error) {
      toast.error('Computer trace export failed', { description: safeErrorMessage(error) });
    } finally {
      setExporting(false);
    }
  }

  if (!run) {
    return (
      <div className="off-computer-view is-empty">
        <div className="off-computer-empty">
          <Icon icon={MonitorSmartphone} size="md" />
          <strong>No computer activity</strong>
          <span>
            Computer Use opens here automatically while an employee runs desktop tools. Install and
            enable the driver in Settings › Computer Use.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setSurface('settings')}>
            Open Settings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="off-computer-view">
      <header className="off-computer-head">
        <div className="off-computer-title">
          <Icon icon={MonitorSmartphone} size="sm" />
          <div>
            <strong>{latest?.targetApp ?? latest?.targetWindow ?? 'Computer Use'}</strong>
            <span>
              {[employeeName, run.phase, latest?.targetWindow, latest?.url]
                .filter(Boolean)
                .join(' · ') || run.threadId}
            </span>
          </div>
        </div>
        <div className="off-computer-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={entries.length === 0 || exporting}
            onClick={() => void exportTrace()}
          >
            <Icon icon={Download} size="sm" />
            {exporting ? 'Exporting' : 'Export trace'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!active}
            onClick={() => conversationRunController.stop(run.threadId)}
          >
            <Icon icon={Square} size="sm" />
            Stop
          </Button>
        </div>
      </header>

      <main className="off-computer-main">
        <section className={cn('off-computer-viewport', active && 'is-live')}>
          {shotSrc ? (
            <img
              src={shotSrc}
              alt={latest?.targetWindow ?? latest?.targetApp ?? 'Computer viewport'}
            />
          ) : (
            <div className="off-computer-viewport-empty">
              <Icon icon={Camera} size="md" />
              <strong>{entries.length === 0 ? 'Waiting for activity' : 'No screenshot yet'}</strong>
              <span>
                {entries.length === 0
                  ? 'This run is active but has not emitted computer activity.'
                  : (shot?.mimeType ?? 'The next screenshot event will appear here.')}
              </span>
            </div>
          )}
        </section>

        <aside className="off-computer-side">
          <PermissionApprovalBar threadId={run.threadId} />
          <section className="off-computer-detail">
            <div className="off-computer-section-head">Action detail</div>
            {selectedEntry ? (
              <div className="off-computer-detail-grid">
                <span>Action</span>
                <code>{selectedEntry.richDetail.action ?? 'observe'}</code>
                <span>Result</span>
                <code>{selectedEntry.richDetail.resultState ?? selectedEntry.state}</code>
                {selectedEntry.richDetail.coordinates ? (
                  <>
                    <span>Point</span>
                    <code>
                      {selectedEntry.richDetail.coordinates.x},{' '}
                      {selectedEntry.richDetail.coordinates.y}
                    </code>
                  </>
                ) : null}
                {selectedEntry.richDetail.textPreview ? (
                  <>
                    <span>Text</span>
                    <code>{selectedEntry.richDetail.textPreview}</code>
                  </>
                ) : null}
              </div>
            ) : (
              <span className="off-computer-muted">No action selected</span>
            )}
          </section>

          <section className="off-computer-artifacts">
            <div className="off-computer-section-head">Artifacts</div>
            {artifactPaths.length === 0 && deliverables.length === 0 ? (
              <span className="off-computer-muted">No artifacts yet</span>
            ) : null}
            {artifactPaths.map((path) => (
              <button key={path} type="button" onClick={() => openArtifactPath(path)}>
                <Icon icon={FileText} size="sm" />
                <span>{fileLeaf(path)}</span>
              </button>
            ))}
            {deliverables.map((deliverable) => (
              <button
                key={deliverable.id}
                type="button"
                onClick={() => openDeliverable(deliverable)}
              >
                <Icon icon={FileText} size="sm" />
                <span>{deliverable.name}</span>
              </button>
            ))}
          </section>
        </aside>
      </main>

      <section className="off-computer-timeline">
        <div className="off-computer-section-head">Timeline · {entries.length}</div>
        <div ref={timelineRef} className="off-computer-timeline-scroll">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (!entry) return null;
              const icon = actionIcon(entry.richDetail.action);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(
                    'off-computer-timeline-row',
                    selectedEntry?.id === entry.id && 'is-active',
                    `is-${entry.state}`,
                  )}
                  style={{
                    position: 'absolute',
                    insetInline: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => setSelectedActivityId(entry.id)}
                >
                  <Icon icon={icon} size="sm" />
                  <span>{entry.richDetail.action ?? entry.tool}</span>
                  <code>
                    {[entry.richDetail.targetApp, entry.richDetail.targetWindow]
                      .filter(Boolean)
                      .join(' / ') || entry.tool}
                  </code>
                  <em>{entry.durationMs != null ? `${entry.durationMs}ms` : entry.state}</em>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
