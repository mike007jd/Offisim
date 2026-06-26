import { useUiState } from '@/app/ui-state.js';
import { getLoopRevision, useLoops } from '@/data/loops.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/design-system/primitives/command.js';
import { Dialog, DialogContent } from '@/design-system/primitives/dialog.js';
import { relativeTime } from '@/lib/utils.js';
import type { LoopDefinition } from '@offisim/shared-types';
import { Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { useLoopPickerStore } from './loop-picker-store.js';
import { insertLoopReferenceFromPicker } from './open-loop-in-office.js';

/**
 * The `/loop` searchable Loop picker (PR-10). Opened by the `/loop` slash command
 * (people-only `@` is untouched). cmdk gives keyboard search + arrow-key
 * navigation for free; each row shows title, profile, current version, and updated
 * time. Selecting a loop inserts a structured, pinned-revision chip into the
 * currently-open Office thread — it does NOT run. The v1 single-primary rule is
 * enforced by the shared insert (a second Loop is blocked with a toast).
 */
export function LoopPicker() {
  const open = useLoopPickerStore((s) => s.open);
  const closePicker = useLoopPickerStore((s) => s.closePicker);
  const companyId = useUiState((s) => s.companyId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const loops = useLoops(companyId || null);

  async function choose(loop: LoopDefinition) {
    if (!selectedThreadId) {
      toast.error('Open a conversation first to reference a Loop.');
      closePicker();
      return;
    }
    if (!loop.currentRevisionId) {
      toast.error(`"${loop.title}" has no ready revision yet.`);
      return;
    }
    const revision = await getLoopRevision(loop.currentRevisionId);
    if (!revision || revision.compileStatus !== 'ready') {
      toast.error(`"${loop.title}" is not ready to use yet.`);
      return;
    }
    const result = insertLoopReferenceFromPicker(selectedThreadId, {
      loopId: loop.loopId,
      revisionId: revision.revisionId,
      titleSnapshot: loop.title,
      revisionNumber: revision.revisionNumber,
      profileId: loop.profileId,
    });
    if (result.ok) closePicker();
  }

  // Only loops with a ready current revision are runnable; show them first but keep
  // drafts visible (greyed, non-ready) so the user understands why one is absent.
  const ready = (loops.data ?? []).filter((l) => l.status === 'ready' && l.currentRevisionId);
  const notReady = (loops.data ?? []).filter((l) => !(l.status === 'ready' && l.currentRevisionId));

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : closePicker())}>
      <DialogContent showClose={false} className="off-command-dialog" aria-label="Reference a Loop">
        <Command loop>
          <CommandInput placeholder="Search Loops by name…" />
          <CommandList>
            <CommandEmpty>
              {loops.isLoading ? 'Loading Loops…' : 'No Loops found. Create one in Loops first.'}
            </CommandEmpty>
            {ready.length ? (
              <CommandGroup heading="Ready to run">
                {ready.map((loop) => (
                  <CommandItem
                    key={loop.loopId}
                    value={`loop ${loop.title} ${loop.profileId}`}
                    onSelect={() => void choose(loop)}
                  >
                    <Repeat />
                    <span className="off-loop-pick-row">
                      <span className="off-loop-pick-name">{loop.title}</span>
                      <span className="off-loop-pick-meta">
                        {loop.profileId} · updated {relativeTime(Date.parse(loop.updatedAt) || Date.now())}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {notReady.length ? (
              <CommandGroup heading="Not ready (no runnable revision)">
                {notReady.map((loop) => (
                  <CommandItem
                    key={loop.loopId}
                    value={`loop ${loop.title} ${loop.profileId}`}
                    disabled
                    onSelect={() => void choose(loop)}
                  >
                    <Repeat />
                    <span className="off-loop-pick-row">
                      <span className="off-loop-pick-name">{loop.title}</span>
                      <span className="off-loop-pick-meta">{loop.status} · {loop.profileId}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
