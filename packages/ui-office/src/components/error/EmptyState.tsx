import { Settings } from 'lucide-react';

interface EmptyStateProps {
  isConfigured: boolean;
  onOpenSettings: () => void;
  /** Callback to send a starter prompt directly into the chat. */
  onSendPrompt?: (text: string) => void;
  /** Whether MCP tools are connected. */
  hasMcpTools?: boolean;
  /** List of employee names in the company (from wizard). */
  employeeNames?: string[];
}

const STARTER_PROMPTS = [
  { label: 'Write a report', text: 'Write a market analysis report' },
  { label: 'Design a logo', text: 'Design a company logo' },
  { label: 'Plan a roadmap', text: 'Plan a product roadmap' },
];

export function EmptyState({ isConfigured, onOpenSettings, onSendPrompt }: EmptyStateProps) {
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-xs text-slate-500">What would you like to do?</p>
      {onSendPrompt && (
        <div className="flex flex-wrap justify-center gap-2 px-4">
          {STARTER_PROMPTS.map(({ label, text }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSendPrompt(text)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-blue-300 hover:border-blue-500/30 transition-all"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-1">
        Use <kbd className="text-slate-500">/</kbd> for commands,{' '}
        <kbd className="text-slate-500">@</kbd> to mention someone
      </p>
    </div>
  );
}
