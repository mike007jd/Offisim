import { reposOrNull } from '@/data/adapters.js';
import { create } from 'zustand';

const FIRST_RUN_SETTING_KEY = 'onboarding:r3:first-run';

export const FIRST_RUN_EXAMPLE_PROMPT = `Create a file named FIRST_WIN.md in this Project folder.

Keep it under 120 words. Include a title, today's date, and exactly three bullets covering the project purpose, the next action, and what “done” means. Then reply with the file path and a one-sentence summary.`;

type FirstRunStatus = 'booting' | 'dormant' | 'active' | 'skipped' | 'completed';

interface FirstRunState {
  status: FirstRunStatus;
  initialized: boolean;
  collapsed: boolean;
  draftPrompts: Record<string, string>;
  initialize: (companyCount: number) => Promise<void>;
  open: () => void;
  setCollapsed: (collapsed: boolean) => void;
  skip: () => Promise<void>;
  complete: () => Promise<void>;
  stagePrompt: (threadId: string, prompt: string) => void;
  consumePrompt: (threadId: string) => string | null;
}

async function persistStatus(status: 'skipped' | 'completed') {
  const repos = await reposOrNull();
  await repos?.settings.set(FIRST_RUN_SETTING_KEY, status);
}

export const useFirstRunState = create<FirstRunState>((set, get) => ({
  status: 'booting',
  initialized: false,
  // Collapse-to-pill is session-only (status alone is persisted): every launch
  // starts expanded, which is the safer first-run default.
  collapsed: false,
  draftPrompts: {},
  initialize: async (companyCount) => {
    if (get().initialized) return;
    const repos = await reposOrNull();
    const persisted = await repos?.settings.get(FIRST_RUN_SETTING_KEY);
    set({
      initialized: true,
      status:
        persisted === 'completed'
          ? 'completed'
          : persisted === 'skipped'
            ? 'skipped'
            : companyCount === 0
              ? 'active'
              : 'dormant',
    });
  },
  // open() must reset collapsed: every "Show/Resume setup guide" entry point
  // (Settings, Personnel, Projects) must expand the card even from pill state.
  open: () => set({ status: 'active', collapsed: false }),
  setCollapsed: (collapsed) => set({ collapsed }),
  skip: async () => {
    await persistStatus('skipped');
    set({ status: 'skipped' });
  },
  complete: async () => {
    await persistStatus('completed');
    set({ status: 'completed' });
  },
  stagePrompt: (threadId, prompt) =>
    set((state) => ({ draftPrompts: { ...state.draftPrompts, [threadId]: prompt } })),
  consumePrompt: (threadId) => {
    const prompt = get().draftPrompts[threadId] ?? null;
    if (!prompt) return null;
    set((state) => {
      const next = { ...state.draftPrompts };
      delete next[threadId];
      return { draftPrompts: next };
    });
    return prompt;
  },
}));

export function openFirstRunGuide() {
  useFirstRunState.getState().open();
}

export function useFirstRunGuideActive() {
  return useFirstRunState((state) => state.status === 'active');
}
