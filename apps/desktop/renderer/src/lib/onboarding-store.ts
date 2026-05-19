import { useSyncExternalStore } from 'react';

export const ONBOARDING_STORAGE_KEY = 'offisim.onboarding.v2';

export interface AccountOnboardingState {
  provider_configured: boolean;
  first_employee_clicked: boolean;
  tour_completed: string[];
  tour_dismissed: boolean;
  welcome_seen: boolean;
  tour_migrated_v1: boolean;
}

export interface CompanyOnboardingState {
  first_task_sent: boolean;
  first_deliverable_seen: boolean;
}

// Single source of truth for "business flag → tour step" mapping. migrateState,
// markAccount, and markCompany all read this so adding a new flag-driven step
// is a one-line change.
const ACCOUNT_FLAG_TO_STEP: Partial<Record<keyof AccountOnboardingState, string>> = {
  provider_configured: 'connect-provider',
};
const COMPANY_FLAG_TO_STEP: Partial<Record<keyof CompanyOnboardingState, string>> = {
  first_task_sent: 'send-first-message',
  first_deliverable_seen: 'open-tasks',
};

function withTourStep(completed: string[], stepId: string | undefined): string[] {
  if (!stepId || completed.includes(stepId)) return completed;
  return [...completed, stepId];
}

export interface OnboardingState {
  account: AccountOnboardingState;
  companies: Record<string, CompanyOnboardingState>;
}

const DEFAULT_ACCOUNT: AccountOnboardingState = {
  provider_configured: false,
  first_employee_clicked: false,
  tour_completed: [],
  tour_dismissed: false,
  welcome_seen: false,
  tour_migrated_v1: false,
};

const EMPTY_COMPANY: CompanyOnboardingState = Object.freeze({
  first_task_sent: false,
  first_deliverable_seen: false,
});

function createEmpty(): OnboardingState {
  return { account: { ...DEFAULT_ACCOUNT }, companies: {} };
}

function loadFromStorage(): OnboardingState {
  if (typeof localStorage === 'undefined') return createEmpty();
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return createEmpty();
    const parsed = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!parsed || typeof parsed !== 'object') return createEmpty();
    return {
      account: { ...DEFAULT_ACCOUNT, ...(parsed.account ?? {}) },
      companies: parsed.companies ?? {},
    };
  } catch {
    return createEmpty();
  }
}

function migrateState(state: OnboardingState): { state: OnboardingState; changed: boolean } {
  if (state.account.tour_migrated_v1) return { state, changed: false };
  const completed = new Set(state.account.tour_completed);
  for (const [flag, stepId] of Object.entries(ACCOUNT_FLAG_TO_STEP)) {
    if (state.account[flag as keyof AccountOnboardingState]) completed.add(stepId);
  }
  for (const company of Object.values(state.companies)) {
    for (const [flag, stepId] of Object.entries(COMPANY_FLAG_TO_STEP)) {
      if (company[flag as keyof CompanyOnboardingState]) completed.add(stepId);
    }
  }
  return {
    changed: true,
    state: {
      ...state,
      account: {
        ...state.account,
        tour_completed: [...completed],
        tour_migrated_v1: true,
      },
    },
  };
}

function saveToStorage(state: OnboardingState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Swallow quota / disabled-storage / private-mode errors — onboarding is UX polish, not core data.
  }
}

const migratedInitialState = migrateState(loadFromStorage());
let current: OnboardingState = migratedInitialState.state;
if (migratedInitialState.changed) saveToStorage(current);
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getOnboardingState(): OnboardingState {
  return current;
}

export function getCompanyOnboardingState(companyId: string): CompanyOnboardingState {
  return current.companies[companyId] ?? EMPTY_COMPANY;
}

export function markAccount(key: keyof AccountOnboardingState): void {
  if (key === 'tour_completed') return;
  if (current.account[key]) return;
  current = {
    ...current,
    account: {
      ...current.account,
      [key]: true,
      tour_completed: withTourStep(current.account.tour_completed, ACCOUNT_FLAG_TO_STEP[key]),
    },
  };
  saveToStorage(current);
  notify();
}

export function completeTourStep(stepId: string): void {
  if (current.account.tour_completed.includes(stepId)) return;
  current = {
    ...current,
    account: {
      ...current.account,
      tour_completed: [...current.account.tour_completed, stepId],
    },
  };
  saveToStorage(current);
  notify();
}

export function uncompleteTourStep(stepId: string): void {
  if (!current.account.tour_completed.includes(stepId)) return;
  current = {
    ...current,
    account: {
      ...current.account,
      tour_completed: current.account.tour_completed.filter((id) => id !== stepId),
      tour_dismissed: false,
    },
  };
  saveToStorage(current);
  notify();
}

export function dismissTour(): void {
  if (current.account.tour_dismissed) return;
  current = {
    ...current,
    account: { ...current.account, tour_dismissed: true },
  };
  saveToStorage(current);
  notify();
}

export function markWelcomeSeen(): void {
  if (current.account.welcome_seen) return;
  current = {
    ...current,
    account: { ...current.account, welcome_seen: true },
  };
  saveToStorage(current);
  notify();
}

export function markCompany(companyId: string, key: keyof CompanyOnboardingState): void {
  const existing = current.companies[companyId] ?? EMPTY_COMPANY;
  if (existing[key]) return;
  current = {
    ...current,
    account: {
      ...current.account,
      tour_completed: withTourStep(current.account.tour_completed, COMPANY_FLAG_TO_STEP[key]),
    },
    companies: {
      ...current.companies,
      [companyId]: { ...existing, [key]: true },
    },
  };
  saveToStorage(current);
  notify();
}

export function resetOnboarding(): void {
  current = createEmpty();
  saveToStorage(current);
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useOnboardingState(): OnboardingState {
  return useSyncExternalStore(subscribe, getOnboardingState, getOnboardingState);
}

export function useCompanyOnboardingState(companyId: string | null): CompanyOnboardingState {
  const state = useOnboardingState();
  if (!companyId) return EMPTY_COMPANY;
  return state.companies[companyId] ?? EMPTY_COMPANY;
}
