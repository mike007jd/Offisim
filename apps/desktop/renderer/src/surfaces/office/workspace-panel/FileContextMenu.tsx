import type { FileNode } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';

export interface FileContextMenuState {
  node: FileNode;
  x: number;
  y: number;
}

export function FileContextMenu({
  state,
  onClose,
  onOpen,
  onPreview,
  onReveal,
}: {
  state: FileContextMenuState;
  onClose: () => void;
  onOpen: (node: FileNode) => void;
  onPreview: (node: FileNode) => void;
  onReveal: (node: FileNode) => void;
}) {
  return (
    <DropdownMenu
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="off-file-context-anchor"
          style={{ left: state.x, top: state.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {state.node.kind === 'file' ? (
          <DropdownMenuItem
            onSelect={() => {
              onPreview(state.node);
            }}
          >
            <Icon icon={FileText} size="sm" />
            Preview in Stage
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            onOpen(state.node);
          }}
        >
          <Icon icon={ExternalLink} size="sm" />
          Open in Default App
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onReveal(state.node);
          }}
        >
          <Icon icon={FolderOpen} size="sm" />
          Show in Finder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
