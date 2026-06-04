import { useUiState } from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useRunStore } from '@/assistant/run-store.js';
import { useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { useActivityRecords } from '@/surfaces/activity/activity-data.js';
import { Activity, Box, Coins, LayoutPanelTop } from 'lucide-react';
import { Suspense, useMemo } from 'react';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';

export function OfficeStage() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);
  const setSurface = useUiState((s) => s.setSurface);
  const companyId = useUiState((s) => s.companyId);
  const activityLastSeenAt = useUiState((s) => s.activityLastSeenAt);
  const markActivityRead = useUiState((s) => s.markActivityRead);

  const runCost = useRunCost();
  const isRunning = useRunStore((s) => s.isRunning);
  const activityRecords = useActivityRecords(companyId);

  // Unread = activity rows with `at` strictly newer than the last-seen stamp.
  // The scene readout owns this state so Office avoids generic header chrome.
  const { unreadCount, newestAt } = useMemo(() => {
    const rows = activityRecords.data ?? [];
    let unread = 0;
    let newest = 0;
    for (const row of rows) {
      if (row.at > activityLastSeenAt) unread += 1;
      if (row.at > newest) newest = row.at;
    }
    return { unreadCount: unread, newestAt: newest };
  }, [activityRecords.data, activityLastSeenAt]);
  const activityLabel =
    unreadCount > 0 ? `Open Activity Log (${unreadCount} unread)` : 'Open Activity Log';

  return (
    <section className={cn('off-stage', isRunning && 'is-live')}>
      <div className="off-scene-host">
        {sceneRenderMode === '3d' ? (
          <Suspense fallback={<div className="off-scene-loading">Loading scene…</div>}>
            <OfficeScene3D />
          </Suspense>
        ) : (
          <OfficeScene2D />
        )}
      </div>

      {/* Pipeline pill: always present while a run is live (Stop lives here). */}
      <RunPipelinePill />

      {/* stage-mode (left): 3D / 2D render toggle. */}
      <div className="off-stage-float off-stage-mode">
        <button
          type="button"
          className={cn('off-stage-mode-btn off-focusable', sceneRenderMode === '3d' && 'is-on')}
          onClick={() => setSceneRenderMode('3d')}
        >
          <Icon icon={Box} size="sm" />
          3D
        </button>
        <button
          type="button"
          className={cn('off-stage-mode-btn off-focusable', sceneRenderMode === '2d' && 'is-on')}
          onClick={() => setSceneRenderMode('2d')}
        >
          <Icon icon={LayoutPanelTop} size="sm" />
          2D
        </button>
      </div>

      {/* Single diegetic cost/token readout on the scene border. */}
      <div className={cn('off-scene-cost', isRunning && 'is-live')}>
        <span className="off-sc-readout">
          <span className="off-sc-beat">
            <Icon icon={Coins} size="sm" />
            <b>{runCost.data ? runCost.data.tokens.toLocaleString() : '0'}</b> tok
          </span>
          <span className="off-sc-div" />
          <b>{runCost.data?.costLabel ?? '$0.00'}</b>
          {isRunning ? (
            <>
              <span className="off-sc-div" />
              <span className="off-sc-live">live</span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          className={cn('off-sc-notif off-focusable', unreadCount > 0 && 'has-unread')}
          aria-label={activityLabel}
          title={activityLabel}
          onClick={() => {
            // newestAt === 0 means no activity rows have arrived yet; skip the
            // mark so a first incoming row can still surface as unread.
            if (newestAt > 0) markActivityRead(newestAt);
            setSurface('activity');
          }}
        >
          <Icon icon={Activity} size="sm" />
          {unreadCount > 0 ? <span className="off-sc-notif-dot" aria-hidden /> : null}
        </button>
      </div>
    </section>
  );
}
