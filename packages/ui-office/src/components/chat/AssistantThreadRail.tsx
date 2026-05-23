import { ThreadListItemPrimitive, ThreadListPrimitive } from '@assistant-ui/react';
import { Archive, MessageSquare, Plus, Trash2 } from 'lucide-react';

export function AssistantThreadRail() {
  return (
    <ThreadListPrimitive.Root className="border-b border-line-soft bg-surface-1 px-sp-2 py-sp-2">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <ThreadListPrimitive.New className="inline-flex h-7 shrink-0 items-center gap-1 rounded-r-sm border border-line-soft bg-surface-2 px-sp-2 text-fs-meta font-semibold text-ink-3 transition hover:border-line hover:bg-surface-sunken hover:text-ink-1 data-[active=true]:border-accent data-[active=true]:bg-accent-surface data-[active=true]:text-accent">
          <Plus className="size-3.5" aria-hidden="true" />
          New
        </ThreadListPrimitive.New>
        <ThreadListPrimitive.Items>
          {() => (
            <ThreadListItemPrimitive.Root className="group inline-flex min-w-0 shrink-0 items-center rounded-r-sm border border-transparent data-[active=true]:border-accent data-[active=true]:bg-accent-surface">
              <ThreadListItemPrimitive.Trigger className="inline-flex h-7 max-w-36 items-center gap-1.5 rounded-r-sm px-sp-2 text-fs-meta text-ink-4 transition hover:bg-surface-sunken hover:text-ink-1 group-data-[active=true]:font-semibold group-data-[active=true]:text-accent">
                <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  <ThreadListItemPrimitive.Title fallback="Untitled" />
                </span>
              </ThreadListItemPrimitive.Trigger>
              <ThreadListItemPrimitive.Archive
                aria-label="Archive thread"
                title="Archive thread"
                className="grid h-7 w-6 place-items-center rounded-none text-ink-4 opacity-0 transition hover:bg-surface-sunken hover:text-ink-1 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Archive className="size-3" aria-hidden="true" />
              </ThreadListItemPrimitive.Archive>
              <ThreadListItemPrimitive.Delete
                aria-label="Delete thread"
                title="Delete thread"
                className="grid h-7 w-6 place-items-center rounded-r-sm text-ink-4 opacity-0 transition hover:bg-danger-surface hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </ThreadListItemPrimitive.Delete>
            </ThreadListItemPrimitive.Root>
          )}
        </ThreadListPrimitive.Items>
        <ThreadListPrimitive.LoadMore className="inline-flex h-7 shrink-0 items-center rounded-r-sm border border-line-soft bg-surface-2 px-sp-2 text-fs-meta font-semibold text-ink-3 transition hover:border-line hover:bg-surface-sunken hover:text-ink-1 disabled:hidden">
          More
        </ThreadListPrimitive.LoadMore>
      </div>
    </ThreadListPrimitive.Root>
  );
}
