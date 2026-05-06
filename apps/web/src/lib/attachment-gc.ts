/**
 * Boot-time chat attachment GC sweeper.
 *
 * Algorithm (v1, conservative):
 * 1. `attachmentStore.listAll()` — enumerate every persisted blob meta.
 * 2. For each meta, look up the parent chat thread or graph thread. Team chat
 *    attachments use graph `threads` (`thread-<companyId>`), while scoped
 *    workspace chats can use `chat_threads`. If both rows are missing, drop
 *    the blob and emit `chat.attachment.gc.dropped` with `reason: 'orphaned'`.
 * 3. Emit `chat.attachment.gc.swept` once at completion with `{ scanned,
 *    dropped, durationMs }`.
 *
 * Time-sliced via `requestIdleCallback` (or `setTimeout` fallback) at 50 ms
 * batches so the sweep never blocks the UI thread on first paint. The sweep
 * is fire-and-forget — `App.tsx` calls `attachmentGcSweeper.run(...)` post-
 * mount and never awaits the returned promise.
 *
 * Soft-archived threads (`archived_at` set) are RETAINED — the spec
 * requires unarchive to restore intact bubbles.
 */
import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import {
  CHAT_ATTACHMENT_GC_DROPPED,
  CHAT_ATTACHMENT_GC_SWEPT,
  type ChatAttachmentGcDroppedPayload,
  type ChatAttachmentGcSweptPayload,
  type VaultRef,
  chatAttachmentEvent,
} from '@offisim/shared-types';
import type { AttachmentStore } from '@offisim/ui-office/web';

const BATCH_BUDGET_MS = 50;

interface IdleDeadline {
  timeRemaining(): number;
  readonly didTimeout: boolean;
}

type IdleScheduler = (cb: (deadline: IdleDeadline) => void) => void;

function scheduleIdle(scheduler?: IdleScheduler): Promise<IdleDeadline> {
  return new Promise((resolve) => {
    const fn = scheduler ?? defaultIdleScheduler;
    fn((d) => resolve(d));
  });
}

function defaultIdleScheduler(cb: (deadline: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback((d) =>
      cb({ timeRemaining: () => d.timeRemaining(), didTimeout: d.didTimeout }),
    );
    return;
  }
  setTimeout(() => {
    const start = Date.now();
    cb({
      timeRemaining: () => Math.max(0, BATCH_BUDGET_MS - (Date.now() - start)),
      didTimeout: false,
    });
  }, 0);
}

export interface AttachmentGcOptions {
  attachmentStore: AttachmentStore;
  repos: RuntimeRepositories;
  eventBus: EventBus | null;
  /** Override for test injection. */
  scheduler?: IdleScheduler;
}

async function shouldDropOrphan(
  meta: { threadId: string; companyId: string },
  repos: RuntimeRepositories,
): Promise<boolean> {
  // The parent thread row may be:
  //   - present + active → retain
  //   - present + archived → retain (soft archive must keep blobs reachable)
  //   - missing → orphan, drop
  const [chatThread, graphThread] = await Promise.all([
    repos.chatThreads.findById(meta.threadId),
    repos.threads.findById(meta.threadId),
  ]);
  return chatThread === null && graphThread === null;
}

/**
 * Run a single boot sweep. Returns the telemetry payload that was emitted, so
 * tests / verification scripts can introspect without subscribing to the bus.
 */
export const attachmentGcSweeper = {
  async run(opts: AttachmentGcOptions): Promise<ChatAttachmentGcSweptPayload> {
    const { attachmentStore, repos, eventBus, scheduler } = opts;
    const start = Date.now();
    let metas: Array<Awaited<ReturnType<AttachmentStore['listAll']>>[number]> = [];
    try {
      metas = await attachmentStore.listAll();
    } catch (err) {
      console.warn('[attachment-gc] listAll failed; aborting sweep', err);
      const aborted: ChatAttachmentGcSweptPayload = {
        scanned: 0,
        dropped: 0,
        durationMs: Date.now() - start,
      };
      return aborted;
    }
    let dropped = 0;
    let i = 0;
    while (i < metas.length) {
      const deadline = await scheduleIdle(scheduler);
      while (i < metas.length && deadline.timeRemaining() > 5) {
        const meta = metas[i];
        i += 1;
        if (!meta) continue;
        try {
          const orphaned = await shouldDropOrphan(meta, repos);
          if (!orphaned) continue;
          const vaultRef =
            `attachment://${meta.companyId}/${meta.threadId}/${meta.attachmentId}` as VaultRef;
          await attachmentStore.delete(vaultRef);
          dropped += 1;
          if (eventBus) {
            const payload: ChatAttachmentGcDroppedPayload = {
              attachmentId: meta.attachmentId,
              threadId: meta.threadId,
              vaultRef,
              reason: 'orphaned',
            };
            eventBus.emit(
              chatAttachmentEvent(
                CHAT_ATTACHMENT_GC_DROPPED,
                { entityId: meta.attachmentId, companyId: meta.companyId, threadId: meta.threadId },
                payload,
              ),
            );
          }
        } catch (err) {
          console.warn('[attachment-gc] sweep entry failed', err);
        }
      }
    }
    const sweptPayload: ChatAttachmentGcSweptPayload = {
      scanned: metas.length,
      dropped,
      durationMs: Date.now() - start,
    };
    if (eventBus) {
      eventBus.emit(
        chatAttachmentEvent(
          CHAT_ATTACHMENT_GC_SWEPT,
          { entityId: 'gc-sweep', companyId: '' },
          sweptPayload,
        ),
      );
    }
    return sweptPayload;
  },
};
