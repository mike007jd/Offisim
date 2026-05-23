import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
} from '@assistant-ui/react';
import { Button } from '@offisim/ui-core';
import { Archive, MessageSquare, MoreHorizontal, Plus, Trash2 } from 'lucide-react';

export function AssistantThreadRail() {
  return (
    <ThreadListPrimitive.Root className="border-b border-line-soft bg-surface-1 px-sp-2 py-sp-2">
      <div className="flex min-w-0 items-center gap-sp-1 overflow-x-auto">
        <ThreadListPrimitive.New
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-sp-7 shrink-0 gap-sp-1 rounded-r-sm border-line-soft bg-surface-2 px-sp-2 text-fs-meta font-semibold text-ink-3 hover:border-line hover:bg-surface-sunken hover:text-ink-1 data-[active=true]:border-accent data-[active=true]:bg-accent-surface data-[active=true]:text-accent"
            />
          }
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New
        </ThreadListPrimitive.New>
        <ThreadListPrimitive.Items>
          {() => (
            <ThreadListItemPrimitive.Root className="group inline-flex min-w-0 shrink-0 items-center rounded-r-sm border border-transparent data-[active=true]:border-accent data-[active=true]:bg-accent-surface">
              <ThreadListItemPrimitive.Trigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-sp-7 max-w-36 justify-start gap-sp-1 rounded-r-sm px-sp-2 text-fs-meta text-ink-4 hover:bg-surface-sunken hover:text-ink-1 group-data-[active=true]:font-semibold group-data-[active=true]:text-accent"
                  />
                }
              >
                <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  <ThreadListItemPrimitive.Title fallback="Untitled" />
                </span>
              </ThreadListItemPrimitive.Trigger>
              <ThreadListItemMorePrimitive.Root>
                <ThreadListItemMorePrimitive.Trigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      aria-label="Thread actions"
                      title="Thread actions"
                      className="h-sp-7 w-sp-7 rounded-r-sm text-ink-4 opacity-0 hover:bg-surface-sunken hover:text-ink-1 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" aria-hidden="true" />
                </ThreadListItemMorePrimitive.Trigger>
                <ThreadListItemMorePrimitive.Content
                  align="end"
                  className="z-popover min-w-32 overflow-hidden rounded-r-md border border-line-soft bg-surface-1 p-sp-1 shadow-elev-2"
                >
                  <ThreadListItemPrimitive.Archive
                    render={
                      <ThreadListItemMorePrimitive.Item className="flex h-sp-8 items-center gap-sp-2 rounded-r-sm px-sp-2 text-fs-sm text-ink-2 outline-none hover:bg-surface-sunken focus:bg-surface-sunken" />
                    }
                  >
                    <Archive className="size-3.5" aria-hidden="true" />
                    Archive
                  </ThreadListItemPrimitive.Archive>
                  <ThreadListItemPrimitive.Delete
                    render={
                      <ThreadListItemMorePrimitive.Item className="flex h-sp-8 items-center gap-sp-2 rounded-r-sm px-sp-2 text-fs-sm text-danger outline-none hover:bg-danger-surface focus:bg-danger-surface" />
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete
                  </ThreadListItemPrimitive.Delete>
                </ThreadListItemMorePrimitive.Content>
              </ThreadListItemMorePrimitive.Root>
            </ThreadListItemPrimitive.Root>
          )}
        </ThreadListPrimitive.Items>
        <ThreadListPrimitive.LoadMore
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-sp-7 shrink-0 rounded-r-sm border-line-soft bg-surface-2 px-sp-2 text-fs-meta font-semibold text-ink-3 hover:border-line hover:bg-surface-sunken hover:text-ink-1 disabled:hidden"
            />
          }
        >
          More
        </ThreadListPrimitive.LoadMore>
      </div>
    </ThreadListPrimitive.Root>
  );
}
