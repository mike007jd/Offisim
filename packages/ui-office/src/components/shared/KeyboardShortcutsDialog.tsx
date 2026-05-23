import { DialogShell } from '@offisim/ui-core';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  { keys: 'Cmd/Ctrl + J', description: 'Toggle Kanban' },
  { keys: 'Cmd/Ctrl + 1', description: 'Toggle 3D / 2D view' },
  { keys: 'Cmd/Ctrl + E', description: 'Edit selected employee' },
  { keys: 'Cmd/Ctrl + /', description: 'Open keyboard shortcuts' },
  { keys: 'Escape', description: 'Close current overlay or selection' },
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      stackId="keyboard-shortcuts"
      size="md"
      title="Keyboard Shortcuts"
    >
      <div className="flex flex-col gap-2">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm"
          >
            <span className="text-text-secondary">{shortcut.description}</span>
            <kbd className="rounded-md border border-border-default bg-surface px-2 py-1 text-caption text-text-muted">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
