import {
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { Button, Input } from '@offisim/ui-core';
import { Archive, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

function ThreadListItemChrome() {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title || 'Untitled');
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  useEffect(() => {
    if (!isRenaming) setDraftTitle(title);
  }, [isRenaming, title]);

  function commitRename() {
    const nextTitle = draftTitle.trim();
    setIsRenaming(false);
    if (nextTitle.length === 0 || nextTitle === title) return;
    void aui.threadListItem().rename(nextTitle);
  }

  return (
    <>
      {isRenaming ? (
        <form
          className="assistant-thread-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <Input
            autoFocus
            aria-label="Rename thread"
            className="assistant-thread-rename-input"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.currentTarget.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraftTitle(title);
                setIsRenaming(false);
              }
            }}
          />
        </form>
      ) : (
        <ThreadListItemPrimitive.Trigger
          render={
            <Button type="button" variant="ghost" size="sm" className="assistant-thread-trigger" />
          }
        >
          <MessageSquare data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">
            <ThreadListItemPrimitive.Title fallback="Untitled" />
          </span>
        </ThreadListItemPrimitive.Trigger>
      )}
      <ThreadListItemMorePrimitive.Root>
        <ThreadListItemMorePrimitive.Trigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              aria-label="Thread actions"
              title="Thread actions"
              className="assistant-thread-more-trigger"
            />
          }
        >
          <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
        </ThreadListItemMorePrimitive.Trigger>
        <ThreadListItemMorePrimitive.Content align="end" className="assistant-thread-menu">
          <ThreadListItemMorePrimitive.Item
            className="assistant-thread-menu-item"
            onSelect={() => {
              setDraftTitle(title);
              setIsRenaming(true);
            }}
          >
            <Pencil data-icon="inline-start" aria-hidden="true" />
            Rename
          </ThreadListItemMorePrimitive.Item>
          <ThreadListItemMorePrimitive.Separator className="assistant-thread-menu-separator" />
          <ThreadListItemPrimitive.Archive
            render={<ThreadListItemMorePrimitive.Item className="assistant-thread-menu-item" />}
          >
            <Archive data-icon="inline-start" aria-hidden="true" />
            Archive
          </ThreadListItemPrimitive.Archive>
          <ThreadListItemPrimitive.Delete
            render={
              <ThreadListItemMorePrimitive.Item className="assistant-thread-menu-item assistant-thread-menu-item-danger" />
            }
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Delete
          </ThreadListItemPrimitive.Delete>
        </ThreadListItemMorePrimitive.Content>
      </ThreadListItemMorePrimitive.Root>
    </>
  );
}

export function AssistantThreadRail() {
  return (
    <ThreadListPrimitive.Root className="assistant-thread-rail-root">
      <div className="assistant-thread-rail-strip custom-scrollbar">
        <ThreadListPrimitive.New
          render={
            <Button type="button" variant="secondary" size="sm" className="assistant-thread-new" />
          }
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          New
        </ThreadListPrimitive.New>
        <ThreadListPrimitive.Items>
          {() => (
            <ThreadListItemPrimitive.Root className="assistant-thread-list-item group">
              <ThreadListItemChrome />
            </ThreadListItemPrimitive.Root>
          )}
        </ThreadListPrimitive.Items>
        <ThreadListPrimitive.LoadMore
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="assistant-thread-load-more"
            />
          }
        >
          More
        </ThreadListPrimitive.LoadMore>
      </div>
    </ThreadListPrimitive.Root>
  );
}
