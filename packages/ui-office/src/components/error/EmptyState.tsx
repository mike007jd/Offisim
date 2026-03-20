import { Settings } from 'lucide-react';

interface EmptyStateProps {
  isConfigured: boolean;
  onOpenSettings: () => void;
  /** Callback to send a starter prompt. */
  onSendPrompt?: (text: string) => void;
  /** Whether MCP tools are connected. */
  hasMcpTools?: boolean;
  /** List of employee names in the company (from wizard). */
  employeeNames?: string[];
}

export function EmptyState({
  isConfigured,
  onOpenSettings,
}: EmptyStateProps) {
  if (!isConfigured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
        <Settings className="h-5 w-5" />
        <p className="text-xs">
          <button type="button" onClick={onOpenSettings} className="text-blue-400 hover:underline">
            Configure provider
          </button>{' '}
          to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-xs text-slate-600">
        Type a message, use <kbd className="text-slate-500">/</kbd> for commands, or <kbd className="text-slate-500">@</kbd> to mention someone.
      </p>
    </div>
  );
}
