import { useUiState } from '@/app/ui-state.js';
import { getLoopDefinition, getLoopRevision } from '@/data/loops.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Repeat, TriangleAlert, X } from 'lucide-react';
import { updateLoopReferenceRevision } from './open-loop-in-office.js';
import { useComposerLoopReferenceStore } from './composer-loop-reference-store.js';

/**
 * The Loop reference chip (PR-10). A structured, pinned-revision reference shown
 * above the composer input. It is NOT a textarea string — it is read from the
 * per-thread loop-reference store.
 *
 *   - shows the Loop icon, title, and pinned `vN`;
 *   - when the loop has a newer ready revision, shows `vN · vN+1 available` and an
 *     explicit Update — never an automatic swap (the pinned revision is the
 *     executed-history anchor);
 *   - when the pinned revision is invalid/deleted, shows an error state that blocks
 *     send (the materializer also re-checks on Send) and offers remove/reselect;
 *   - remove drops the chip; "open detail" navigates to the Loop's page.
 */
export function ComposerLoopChip({ threadId }: { threadId: string }) {
  const reference = useComposerLoopReferenceStore((s) => s.byThread[threadId]);
  const removeReference = useComposerLoopReferenceStore((s) => s.removeReference);
  const openLoopDetail = useUiState((s) => s.openLoopDetail);

  // Fresh read of the pinned revision + the loop's CURRENT revision so the chip can
  // surface "newer available" / "invalid" without ever auto-swapping. Keyed by the
  // pinned revision id so a different chip refetches.
  const status = useQuery({
    queryKey: ['loop-chip', reference?.loopId ?? null, reference?.revisionId ?? null],
    queryFn: async (): Promise<LoopChipStatus> => {
      if (!reference) return { kind: 'missing' };
      const pinned = await getLoopRevision(reference.revisionId);
      if (!pinned) return { kind: 'invalid' };
      if (pinned.compileStatus !== 'ready') return { kind: 'invalid' };
      const def = await getLoopDefinition(reference.loopId);
      if (def?.currentRevisionId && def.currentRevisionId !== reference.revisionId) {
        const current = await getLoopRevision(def.currentRevisionId);
        if (current && current.compileStatus === 'ready' && current.revisionNumber > reference.revisionNumber) {
          return {
            kind: 'newer-available',
            currentRevisionId: current.revisionId,
            currentRevisionNumber: current.revisionNumber,
            profileId: def.profileId,
            title: def.title,
          };
        }
      }
      return { kind: 'current' };
    },
    enabled: !!reference,
  });

  if (!reference) return null;

  const chipStatus: LoopChipStatus = status.data ?? { kind: 'current' };
  const invalid = chipStatus.kind === 'invalid' || chipStatus.kind === 'missing';
  const newer = chipStatus.kind === 'newer-available' ? chipStatus : null;

  return (
    <div className="off-loop-chips" aria-label="Referenced Loop">
      <div className={cn('off-loop-chip', invalid && 'is-invalid', newer && 'is-stale')}>
        <span className="off-loop-chip-icon">
          <Icon icon={invalid ? TriangleAlert : Repeat} size="sm" />
        </span>
        <span className="off-loop-chip-text">
          <button
            type="button"
            className="off-loop-chip-name off-focusable"
            title="Open Loop detail"
            onClick={() => openLoopDetail(reference.loopId)}
          >
            <span>{reference.titleSnapshot}</span>
            <Icon icon={ExternalLink} size="sm" />
          </button>
          <span className="off-loop-chip-meta">
            {invalid ? (
              <span className="off-loop-chip-warn">Revision unavailable — remove or reselect</span>
            ) : newer ? (
              <span className="off-loop-chip-stale">
                v{reference.revisionNumber} · v{newer.currentRevisionNumber} available
              </span>
            ) : (
              <span>v{reference.revisionNumber}</span>
            )}
          </span>
        </span>
        {newer ? (
          <button
            type="button"
            className="off-loop-chip-update off-focusable"
            title={`Update to v${newer.currentRevisionNumber}`}
            onClick={() =>
              updateLoopReferenceRevision(threadId, {
                loopId: reference.loopId,
                revisionId: newer.currentRevisionId,
                titleSnapshot: newer.title,
                revisionNumber: newer.currentRevisionNumber,
                profileId: newer.profileId,
              })
            }
          >
            Update
          </button>
        ) : null}
        <button
          type="button"
          className="off-loop-chip-x off-focusable"
          aria-label={`Remove Loop ${reference.titleSnapshot}`}
          onClick={() => removeReference(threadId)}
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>
    </div>
  );
}

type LoopChipStatus =
  | { kind: 'current' }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | {
      kind: 'newer-available';
      currentRevisionId: string;
      currentRevisionNumber: number;
      profileId: string;
      title: string;
    };
