import { DialogShell } from '@offisim/ui-core';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  { keys: 'Cmd/Ctrl + D', description: 'Toggle Dashboard' },
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
      <div className="space-y-2">
        {SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="flex items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-sm"
          >
            <span className="text-slate-300">{shortcut.description}</span>
            <kbd className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-400">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
