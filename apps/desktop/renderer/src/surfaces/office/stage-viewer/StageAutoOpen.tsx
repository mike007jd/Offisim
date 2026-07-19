import { useUiState } from '@/app/ui-state.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { useDeliverables } from '@/data/queries.js';
import { BoardPendingReviewAutoOpen } from '@/surfaces/office/board/BoardStage.js';
import { useEffect, useRef } from 'react';

export function StageAutoOpen() {
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  return (
    <>
      <BoardPendingReviewAutoOpen />
      {selectedThreadId ? (
        <StageAutoOpenForThread key={selectedThreadId} threadId={selectedThreadId} />
      ) : null}
    </>
  );
}

function StageAutoOpenForThread({ threadId }: { threadId: string }) {
  const openStageView = useUiState((s) => s.openStageView);
  const deliverables = useDeliverables(threadId);
  const runs = useActiveConversationRuns();
  const run = runs.runs.find((candidate) => candidate.threadId === threadId) ?? null;
  const seenDeliverables = useRef<Set<string> | null>(null);
  const seenBrowserActivities = useRef<Set<string> | null>(null);
  const seenComputerActivities = useRef<Set<string> | null>(null);

  useEffect(() => {
    const rows = deliverables.data;
    if (!rows) return;
    const ids = new Set(rows.map((d) => d.id));
    if (!seenDeliverables.current) {
      seenDeliverables.current = ids;
      return;
    }
    const fresh = rows.find((d) => !seenDeliverables.current?.has(d.id));
    seenDeliverables.current = ids;
    if (!fresh) return;
    openStageView({
      kind: 'preview',
      ref: {
        source: 'deliverable',
        deliverableId: fresh.id,
        threadId,
        format: fresh.format ?? undefined,
        name: fresh.name,
      },
      title: fresh.name,
    });
  }, [deliverables.data, openStageView, threadId]);

  useEffect(() => {
    if (!run) return;
    const browserActivities = run.activity.filter(
      (entry) =>
        entry.richDetail?.family === 'browser' &&
        (entry.richDetail.url || entry.richDetail.screenshot),
    );
    const ids = new Set(browserActivities.map((entry) => entry.id));
    if (!seenBrowserActivities.current) {
      seenBrowserActivities.current = ids;
      return;
    }
    const latest = [...browserActivities]
      .reverse()
      .find((entry) => !seenBrowserActivities.current?.has(entry.id));
    seenBrowserActivities.current = ids;
    if (!latest?.richDetail || latest.richDetail.family !== 'browser') return;
    openStageView({
      kind: 'preview',
      ref: {
        source: 'browser',
        sourceId: latest.id,
        url: latest.richDetail.url,
        detail: latest.richDetail,
      },
      title: latest.richDetail.title ?? latest.tool,
    });
  }, [openStageView, run]);

  useEffect(() => {
    if (!run) return;
    const computerActivities = run.activity.filter(
      (entry) => entry.richDetail?.family === 'computer',
    );
    const ids = new Set(computerActivities.map((entry) => entry.id));
    if (!seenComputerActivities.current) {
      seenComputerActivities.current = ids;
      return;
    }
    const latest = [...computerActivities]
      .reverse()
      .find((entry) => !seenComputerActivities.current?.has(entry.id));
    seenComputerActivities.current = ids;
    if (!latest) return;
    openStageView({ kind: 'computer', threadId });
  }, [openStageView, run, threadId]);

  return null;
}
