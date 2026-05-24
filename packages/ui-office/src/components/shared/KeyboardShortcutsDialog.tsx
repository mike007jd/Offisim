import { DialogShell } from '@offisim/ui-core';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
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
            className="flex items-center justify-between rounded-r-md border border-line-soft bg-surface-2 px-3 py-2 text-sm"
          >
            <span className="text-ink-2">{shortcut.description}</span>
            <kbd className="rounded-md border border-line bg-surface px-2 py-1 text-fs-micro text-ink-3">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
