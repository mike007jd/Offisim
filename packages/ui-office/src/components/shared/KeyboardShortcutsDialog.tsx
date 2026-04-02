import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@offisim/ui-core';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS = [
  { keys: 'Cmd/Ctrl + D', description: '切换 Dashboard' },
  { keys: 'Cmd/Ctrl + J', description: '切换 Kanban' },
  { keys: 'Cmd/Ctrl + 1', description: '切换 3D / 2D 视图' },
  { keys: 'Cmd/Ctrl + E', description: '编辑当前选中的员工' },
  { keys: 'Cmd/Ctrl + /', description: '打开快捷键帮助' },
  { keys: 'Escape', description: '关闭当前 overlay 或选中面板' },
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-3 space-y-2">
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
      </DialogContent>
    </Dialog>
  );
}
