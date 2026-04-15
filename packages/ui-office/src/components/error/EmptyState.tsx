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
  { label: 'Market report', text: 'Write a short market analysis report for this market.' },
  { label: 'Launch plan', text: 'Draft a launch plan with milestones and owners.' },
  { label: 'Hiring brief', text: 'Write a hiring brief for the next role this team needs.' },
];

export function EmptyState({
  isConfigured,
  onSendPrompt,
  welcome,
  starterPrompts,
}: EmptyStateProps) {
  if (!isConfigured) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center overflow-y-auto px-6 text-slate-500">
        <p className="text-xs">Enter a task and watch your AI team collaborate.</p>
      </div>
    );
  }

  const prompts = (starterPrompts ?? FALLBACK_STARTER_PROMPTS).slice(0, 2);

  return (
    <div className="flex flex-1 min-h-0 overflow-y-auto px-6">
      <div className="m-auto flex w-full max-w-sm flex-col items-center gap-3 py-4 text-center">
        {welcome && (
          <div className="w-full rounded-2xl border border-cyan-400/15 bg-cyan-400/4 px-4 py-3">
            <h3 className="text-[13px] font-semibold text-white">{welcome.title}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{welcome.body}</p>
          </div>
        )}
        {onSendPrompt && (
          <div className="flex flex-wrap justify-center gap-2">
            {prompts.map(({ label, text }) => (
              <button
                key={label}
                type="button"
                onClick={() => onSendPrompt(text)}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-blue-300 hover:border-blue-500/30 transition-all"
                data-onboarding-starter-prompt={label}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500/80">
          Start in team chat, then use <kbd className="text-slate-500">@</kbd> for a direct ask.
        </p>
      </div>
    </div>
  );
}
