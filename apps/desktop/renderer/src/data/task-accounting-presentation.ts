import type { AiSubscriptionUsageLimit } from '@offisim/shared-types';
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

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function nativeValue(value: number | string): string {
  return typeof value === 'number' ? compactNumber(value) : value;
}

function resetLabel(value: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)}`;
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

function selectedNativeLimit(limits: readonly AiSubscriptionUsageLimit[]) {
  const reached = limits.find((limit) => Boolean(limit.reachedType?.trim()));
  const limit = reached ?? limits.find((candidate) => candidate.windows.length > 0) ?? limits[0];
  if (!limit) return { limit: null, window: null, reached: false };
  const reachedKind = limit.reachedType?.trim();
  const window =
    limit.windows.find((candidate) => candidate.kind === reachedKind) ??
    limit.windows.find((candidate) => candidate.kind === 'primary') ??
    limit.windows[0] ??
    null;
  return { limit, window, reached: Boolean(reachedKind) };
}

function subscriptionPresentation(cost: RunCost): TaskAccountingPresentation {
  const usage = cost.sessionSubscriptionUsage;
  const budgetTone = explicitBudgetTone(cost);
  if (!usage) {
    return {
      kind: 'subscription',
      primary: 'Usage unavailable',
      secondary: null,
      tone: budgetTone,
      ariaLabel: 'Subscription usage unavailable',
      title: 'This subscription did not report a native usage window.',
    };
  }

  const selected = selectedNativeLimit(usage.limits);
  const providerTone = selected.reached ? 'critical' : 'neutral';
  const tone =
    providerTone === 'critical' || budgetTone === 'critical'
      ? 'critical'
      : budgetTone === 'warning'
        ? 'warning'
        : 'neutral';
  if (selected.window) {
    const remaining = `${selected.window.remainingIsDerived ? '≈' : ''}${nativeValue(selected.window.remaining)} remaining`;
    const reset = selected.window.resetAt ? resetLabel(selected.window.resetAt) : null;
    return {
      kind: 'subscription',
      primary: remaining,
      secondary: reset ?? selected.limit?.label ?? 'Provider usage',
      tone,
      ariaLabel: `Subscription usage: ${remaining}${reset ? `, ${reset.toLowerCase()}` : ''}`,
      title: selected.window.remainingIsDerived
        ? 'Provider-reported subscription usage; remaining is derived from reported use.'
        : 'Provider-reported subscription usage.',
    };
  }

  if (selected.limit?.credits !== undefined) {
    const credits = `${nativeValue(selected.limit.credits)} credits`;
    return {
      kind: 'subscription',
      primary: credits,
      secondary: selected.limit.label,
      tone,
      ariaLabel: `Subscription usage: ${credits}`,
      title: 'Provider-reported subscription credit balance.',
    };
  }

  if (usage.resetCredits !== undefined) {
    const resetCredits = `${nativeValue(usage.resetCredits)} reset credits`;
    return {
      kind: 'subscription',
      primary: resetCredits,
      secondary: 'Provider usage',
      tone,
      ariaLabel: `Subscription usage: ${resetCredits}`,
      title: 'Provider-issued rate-limit reset credits.',
    };
  }

  if (usage.activity?.lifetimeTokens !== undefined) {
    const lifetime = `${compactNumber(usage.activity.lifetimeTokens)} lifetime tokens`;
    return {
      kind: 'subscription',
      primary: lifetime,
      secondary: 'Provider activity',
      tone,
      ariaLabel: `Subscription usage: ${lifetime}`,
      title: 'Provider-reported subscription activity.',
    };
  }

  return {
    kind: 'subscription',
    primary: 'Usage unavailable',
    secondary: null,
    tone,
    ariaLabel: 'Subscription usage unavailable',
    title: 'This subscription did not report a native usage value.',
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
