export interface StarterPrompt {
  label: string;
  text: string;
}

export interface EmptyStateWelcome {
  title: string;
  body: string;
}

interface EmptyStateProps {
  isConfigured: boolean;
  /** Callback to send a starter prompt directly into the chat. */
  onSendPrompt?: (text: string) => void;
  /** Whether MCP tools are connected. */
  hasMcpTools?: boolean;
  /** List of employee names in the company (from wizard). */
  employeeNames?: string[];
  /** First-run welcome card shown above starter prompts. */
  welcome?: EmptyStateWelcome;
  /** Template-aware starter prompts; falls back to a generic set if omitted. */
  starterPrompts?: readonly StarterPrompt[];
}

const FALLBACK_STARTER_PROMPTS: readonly StarterPrompt[] = [
  { label: 'Write a report', text: 'Write a market analysis report' },
  { label: 'Design a logo', text: 'Design a company logo' },
  { label: 'Plan a roadmap', text: 'Plan a product roadmap' },
];

export function EmptyState({
  isConfigured,
  onSendPrompt,
  welcome,
  starterPrompts,
}: EmptyStateProps) {
  if (!isConfigured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
        <p className="text-xs">Enter a task and watch your AI team collaborate.</p>
      </div>
    );
  }

  const prompts = starterPrompts ?? FALLBACK_STARTER_PROMPTS;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
      {welcome && (
        <div className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-center">
          <h3 className="text-sm font-semibold text-white">{welcome.title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{welcome.body}</p>
        </div>
      )}
      <p className="text-xs text-slate-500">What would you like to do?</p>
      {onSendPrompt && (
        <div className="flex flex-wrap justify-center gap-2">
          {prompts.map(({ label, text }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSendPrompt(text)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-blue-300 hover:border-blue-500/30 transition-all"
              data-onboarding-starter-prompt={label}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        Use <kbd className="text-slate-500">/</kbd> for commands,{' '}
        <kbd className="text-slate-500">@</kbd> to mention someone
      </p>
    </div>
  );
}
