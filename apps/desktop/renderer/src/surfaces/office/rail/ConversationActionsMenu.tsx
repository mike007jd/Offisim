import { useArchiveThread, useDeleteConversation, useRenameThread } from '@/data/queries.js';
import type { ChatThread } from '@/data/types.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Input } from '@/design-system/primitives/input.js';
import { cn } from '@/lib/utils.js';
import { Archive, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface ConversationActionsMenuProps {
  thread: ChatThread;
  projectId: string | null;
  companyId: string | null;
  align?: 'start' | 'center' | 'end';
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onArchived?: () => void;
  onDeleted?: () => void;
}

function mutationErrorMessage(result: { missing?: boolean }): string {
  return result.missing ? 'Conversation no longer exists.' : "Can't save in this build.";
}

export function ConversationActionsMenu({
  thread,
  projectId,
  companyId,
  align = 'end',
  className,
  open,
  onOpenChange,
  onArchived,
  onDeleted,
}: ConversationActionsMenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(thread.title);
  const renameThread = useRenameThread(projectId);
  const archiveThread = useArchiveThread(projectId);
  const deleteConversation = useDeleteConversation(projectId, companyId);
  const locked = thread.runState === 'running' || thread.runState === 'paused';
  const busy = renameThread.isPending || archiveThread.isPending || deleteConversation.isPending;

  useEffect(() => {
    if (!renameOpen) setRenameDraft(thread.title);
  }, [renameOpen, thread.title]);

  function commitRename() {
    const next = renameDraft.trim();
    if (!next || next === thread.title) {
      setRenameOpen(false);
      return;
    }
    renameThread.mutate(
      { threadId: thread.id, title: next },
      {
        onSuccess: (result) => {
          setRenameOpen(false);
          if (result.persisted) toast.success('Conversation renamed');
          else toast.error(mutationErrorMessage(result));
        },
        onError: (error) => {
          toast.error('Rename failed', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        },
      },
    );
  }

  function archiveConversation() {
    if (locked) return;
    archiveThread.mutate(
      { threadId: thread.id },
      {
        onSuccess: (result) => {
          if (result.persisted) {
            toast.success('Conversation archived');
            onArchived?.();
          } else {
            toast.error(mutationErrorMessage(result));
          }
        },
        onError: (error) => {
          toast.error('Archive failed', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        },
      },
    );
  }

  function deleteThread() {
    if (locked) return;
    deleteConversation.mutate(
      { threadId: thread.id },
      {
        onSuccess: (result) => {
          setDeleteOpen(false);
          if (result.persisted) {
            toast.success('Conversation deleted', {
              description: 'Messages, tool logs, approvals, and deliverables were cleared.',
            });
            onDeleted?.();
          } else {
            toast.error(mutationErrorMessage(result));
          }
        },
        onError: (error) => {
          toast.error('Delete failed', {
            description: error instanceof Error ? error.message : 'Unknown error',
          });
        },
      },
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="iconSm"
            className={cn('off-thread-action', className)}
            aria-label={`Conversation actions for ${thread.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="off-thread-menu">
          <DropdownMenuLabel>Conversation</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setRenameOpen(true);
            }}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={locked || busy} onSelect={archiveConversation}>
            <Archive />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={locked || busy}
            className="is-danger"
            onSelect={(event) => {
              event.preventDefault();
              setDeleteOpen(true);
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
          {locked ? (
            <DropdownMenuLabel className="off-thread-menu-note">
              Stop the run before archiving or deleting.
            </DropdownMenuLabel>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="off-dialog-w-sm" title="Rename conversation">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Use a short name that makes this task easy to find.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
            }}
            disabled={renameThread.isPending}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={commitRename} disabled={renameThread.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="off-dialog-w-sm" title="Delete conversation">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This removes local messages, tool logs, approvals, deliverables, and run history for
              this conversation. Workspace files are not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteThread}
              disabled={deleteConversation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
