import type { FileNode } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';
import type { CSSProperties } from 'react';

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
  const style = {
    left: state.x,
    top: state.y,
  } as CSSProperties;

  return (
    <div
      className="off-file-context-menu"
      role="menu"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {state.node.kind === 'file' ? (
        <button
          type="button"
          role="menuitem"
          className="off-file-context-item off-focusable"
          onClick={() => {
            onPreview(state.node);
            onClose();
          }}
        >
          <Icon icon={FileText} size="sm" />
          Preview in Stage
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="off-file-context-item off-focusable"
        onClick={() => {
          onOpen(state.node);
          onClose();
        }}
      >
        <Icon icon={ExternalLink} size="sm" />
        Open in Default App
      </button>
      <button
        type="button"
        role="menuitem"
        className="off-file-context-item off-focusable"
        onClick={() => {
          onReveal(state.node);
          onClose();
        }}
      >
        <Icon icon={FolderOpen} size="sm" />
        Show in Finder
      </button>
    </div>
  );
}
