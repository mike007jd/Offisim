import { Button } from '@aics/ui-core';
import {
  AlertTriangle,
  FileText,
  Lightbulb,
  MessageSquare,
  Settings,
  TrendingUp,
} from 'lucide-react';

interface StarterPrompt {
  icon: React.ReactNode;
  label: string;
  prompt: string;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    icon: <FileText className="h-4 w-4" />,
    label: 'Write a blog post',
    prompt: '写一篇关于AI趋势的博客文章，要求有深度、有数据支撑',
  },
  {
    icon: <Lightbulb className="h-4 w-4" />,
    label: 'Make a project plan',
    prompt: '帮我做一个为期两周的项目计划，目标是开发一个用户反馈系统',
  },
  {
    icon: <TrendingUp className="h-4 w-4" />,
    label: 'Market analysis',
    prompt: '分析SaaS行业的竞争格局，列出主要玩家和趋势',
  },
];

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
  onSendPrompt,
  hasMcpTools,
  employeeNames,
}: EmptyStateProps) {
  if (!isConfigured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-shell">
        <Settings className="h-10 w-10" />
        <div className="text-center">
          <p className="font-medium">No provider configured</p>
          <p className="text-sm mt-1">
            <button type="button" onClick={onOpenSettings} className="text-accent hover:underline">
              Open settings
            </button>{' '}
            to configure your LLM provider.
          </p>
        </div>
      </div>
    );
  }

  const teamLine = employeeNames?.length
    ? `Your team: ${employeeNames.join(', ')}`
    : 'Your AI team is ready and waiting for instructions.';

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-shell">
      <MessageSquare className="h-10 w-10 text-coral" />
      <div className="text-center max-w-md">
        <p className="font-pixel-display text-sm uppercase tracking-wider text-sand">
          Ready to work
        </p>
        <p className="text-xs mt-2 text-shell/80 font-pixel-mono">{teamLine}</p>
      </div>

      {/* Starter prompts */}
      {onSendPrompt && (
        <div className="w-full max-w-sm space-y-2">
          <p className="text-[10px] text-shell/60 font-pixel-mono text-center uppercase tracking-wider">
            Try a starter prompt
          </p>
          <div className="space-y-1.5">
            {STARTER_PROMPTS.map((sp) => (
              <Button
                key={sp.label}
                variant="ghost"
                className="w-full justify-start gap-3 h-auto py-2.5 px-3 text-left text-xs text-sand hover:bg-ocean-light/30 border border-ocean-light/20 hover:border-ocean-light/40 transition-colors"
                onClick={() => onSendPrompt(sp.prompt)}
              >
                <span className="shrink-0 text-coral">{sp.icon}</span>
                <span className="flex-1">
                  <span className="block font-medium">{sp.label}</span>
                  <span className="block text-[10px] text-shell/60 mt-0.5 truncate">
                    {sp.prompt}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Configuration notices */}
      {hasMcpTools === false && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded bg-ocean-deep/50 border border-ocean-light/20 max-w-sm w-full">
          <AlertTriangle className="h-3.5 w-3.5 text-sand/60 shrink-0" />
          <span className="text-[10px] text-shell/60 font-pixel-mono">
            MCP tools not configured — some abilities unavailable.{' '}
            <button type="button" onClick={onOpenSettings} className="text-coral hover:underline">
              Configure in Settings
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
