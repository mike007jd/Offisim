import { useSyncExternalStore } from 'react';

export const ONBOARDING_STORAGE_KEY = 'offisim.onboarding.v2';

export interface AccountOnboardingState {
  provider_configured: boolean;
  first_employee_clicked: boolean;
}

export interface CompanyOnboardingState {
  first_task_sent: boolean;
  first_deliverable_seen: boolean;
}

export interface OnboardingState {
  account: AccountOnboardingState;
  companies: Record<string, CompanyOnboardingState>;
}

const DEFAULT_ACCOUNT: AccountOnboardingState = {
  provider_configured: false,
  first_employee_clicked: false,
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

function saveToStorage(state: OnboardingState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Swallow quota / disabled-storage / private-mode errors — onboarding is UX polish, not core data.
  }
}

let current: OnboardingState = loadFromStorage();
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
  if (current.account[key]) return;
  current = {
    ...current,
    account: { ...current.account, [key]: true },
  };
  saveToStorage(current);
  notify();
}

export function markCompany(companyId: string, key: keyof CompanyOnboardingState): void {
  const existing = current.companies[companyId] ?? EMPTY_COMPANY;
  if (existing[key]) return;
  current = {
    ...current,
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
