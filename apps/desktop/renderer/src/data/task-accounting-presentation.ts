import type { RunCost } from './types.js';
import { formatUsageTokens } from './usage-token-coverage.js';

type TaskAccountingTone = 'neutral' | 'warning' | 'critical';

export interface TaskAccountingPresentation {
  readonly kind: 'none' | 'api' | 'subscription' | 'mixed';
  readonly primary: string;
  readonly secondary: string | null;
  readonly tone: TaskAccountingTone;
  readonly ariaLabel: string;
  readonly title: string;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function explicitBudgetTone(cost: RunCost): TaskAccountingTone {
  const alert =
    cost.alerts.find(
      (candidate) => candidate.scope === 'session' && candidate.level === 'critical',
    ) ??
    cost.alerts.find((candidate) => candidate.scope === 'session') ??
    null;
  return alert?.level ?? 'neutral';
}

function subscriptionPresentation(cost: RunCost): TaskAccountingPresentation {
  const tokens =
    cost.sessionTokenCoverage === 'unavailable'
      ? '0 known tok'
      : formatUsageTokens({
          knownTokens: cost.sessionKnownTokens,
          coverage: cost.sessionTokenCoverage,
        });
  const duration = formatDuration(cost.sessionDurationMs);
  return {
    kind: 'subscription',
    primary: `${tokens} · ${duration}`,
    secondary: '订阅内 · 无 API 成本',
    tone: explicitBudgetTone(cost),
    ariaLabel: `Subscription task usage: ${tokens}; duration ${duration}; no API cost`,
    title:
      'Selected Conversation local token count and duration; subscription runs have no API cost.',
  };
}

export function taskAccountingPresentation(
  cost: RunCost | null | undefined,
): TaskAccountingPresentation {
  if (!cost) {
    return {
      kind: 'none',
      primary: 'Usage loading',
      secondary: null,
      tone: 'neutral',
      ariaLabel: 'Task usage loading',
      title: 'Loading the selected Conversation accounting record.',
    };
  }
  if (cost.sessionAccounts.length === 0) {
    return {
      kind: 'none',
      primary: 'No task usage',
      secondary: null,
      tone: explicitBudgetTone(cost),
      ariaLabel: 'No task usage recorded',
      title: 'The selected Conversation has no recorded run usage.',
    };
  }
  if (cost.sessionAccounts.length !== 1) {
    return {
      kind: 'mixed',
      primary: 'Usage split across accounts',
      secondary: null,
      tone: explicitBudgetTone(cost),
      ariaLabel: 'Task usage is split across multiple accounts',
      title: 'Cost is hidden because this Conversation contains more than one accounting lane.',
    };
  }
  if (cost.sessionAccounts[0]?.billingMode === 'subscription') {
    return subscriptionPresentation(cost);
  }

  const tokens = formatUsageTokens({
    knownTokens: cost.sessionKnownTokens,
    coverage: cost.sessionTokenCoverage,
  });
  return {
    kind: 'api',
    primary: tokens,
    secondary: cost.sessionCostLabel,
    tone: explicitBudgetTone(cost),
    ariaLabel: `API task usage: ${tokens}; ${cost.sessionCostLabel}`,
    title: 'Selected Conversation token usage and API cost.',
  };
}
