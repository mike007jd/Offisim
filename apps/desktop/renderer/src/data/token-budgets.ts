import { reposOrNull } from './adapters.js';
import type { TokenBudgetSettings } from './token-budget-policy.js';
export {
  computeTokenBudgetAlerts,
  type TokenBudgetSettings,
} from './token-budget-policy.js';

const emptyBudgets: TokenBudgetSettings = {
  monthlyTokenBudget: null,
  sessionTokenBudget: null,
};

const settingsKey = (companyId: string) => `company:${companyId}:token-budgets`;

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function loadTokenBudgets(companyId: string | null): Promise<TokenBudgetSettings> {
  if (!companyId) return emptyBudgets;
  const repos = await reposOrNull();
  if (!repos?.settings) return emptyBudgets;
  const raw = await repos.settings.get(settingsKey(companyId));
  if (!raw) return emptyBudgets;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      monthlyTokenBudget: positiveInteger(parsed.monthlyTokenBudget),
      sessionTokenBudget: positiveInteger(parsed.sessionTokenBudget),
    };
  } catch {
    return emptyBudgets;
  }
}

export async function saveTokenBudgets(
  companyId: string,
  budgets: TokenBudgetSettings,
): Promise<TokenBudgetSettings> {
  const repos = await reposOrNull();
  if (!repos?.settings) throw new Error('Budget settings need the desktop app.');
  const normalized = {
    monthlyTokenBudget: positiveInteger(budgets.monthlyTokenBudget),
    sessionTokenBudget: positiveInteger(budgets.sessionTokenBudget),
  };
  await repos.settings.set(settingsKey(companyId), JSON.stringify(normalized));
  return normalized;
}
