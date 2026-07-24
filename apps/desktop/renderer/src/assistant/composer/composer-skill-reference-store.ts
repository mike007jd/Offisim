import { create } from 'zustand';

export const MAX_COMPOSER_SKILL_REFERENCES = 3;

export type ComposerSkillSource = 'company' | 'employee' | 'project';

/** Structured Skill reference held only for the lifetime of a thread draft. */
export interface ComposerSkillReference {
  /** Local chip id, stable until the chip is removed or the message is sent. */
  id: string;
  skillId: string;
  name: string;
  description: string;
  source: ComposerSkillSource;
  /** Vault-owned SKILL.md path for company/employee skills. */
  vault_path?: string;
  /** Project-relative SKILL.md path for project-owned skills. */
  relativePath?: string;
  insertedAt: number;
}

export type InsertSkillReferenceInput = Omit<ComposerSkillReference, 'id' | 'insertedAt'>;

type InsertSkillReferenceResult =
  | { ok: true; reference: ComposerSkillReference }
  | { ok: false; reason: 'already-present'; existing: ComposerSkillReference }
  | { ok: false; reason: 'limit-reached'; limit: number };

interface ComposerSkillReferenceStore {
  byThread: Record<string, ComposerSkillReference[]>;
  insertReference: (
    threadId: string,
    input: InsertSkillReferenceInput,
  ) => InsertSkillReferenceResult;
  removeReference: (threadId: string, skillId: string) => void;
  clearReferences: (threadId: string) => void;
}

function nextChipId(): string {
  return `skillref-${crypto.randomUUID()}`;
}

export const useComposerSkillReferenceStore = create<ComposerSkillReferenceStore>((set, get) => ({
  byThread: {},
  insertReference: (threadId, input) => {
    const current = get().byThread[threadId] ?? [];
    const existing = current.find((reference) => reference.skillId === input.skillId);
    if (existing) return { ok: false, reason: 'already-present', existing };
    if (current.length >= MAX_COMPOSER_SKILL_REFERENCES) {
      return { ok: false, reason: 'limit-reached', limit: MAX_COMPOSER_SKILL_REFERENCES };
    }
    const reference: ComposerSkillReference = {
      ...input,
      id: nextChipId(),
      insertedAt: Date.now(),
    };
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadId]: [...(state.byThread[threadId] ?? []), reference],
      },
    }));
    return { ok: true, reference };
  },
  removeReference: (threadId, skillId) =>
    set((state) => {
      const current = state.byThread[threadId];
      if (!current?.some((reference) => reference.skillId === skillId)) return {};
      const next = { ...state.byThread };
      const remaining = current.filter((reference) => reference.skillId !== skillId);
      if (remaining.length) next[threadId] = remaining;
      else delete next[threadId];
      return { byThread: next };
    }),
  clearReferences: (threadId) =>
    set((state) => {
      if (!state.byThread[threadId]) return {};
      const next = { ...state.byThread };
      delete next[threadId];
      return { byThread: next };
    }),
}));

export function resolveSkillReferences(threadId: string): ComposerSkillReference[] {
  return useComposerSkillReferenceStore.getState().byThread[threadId] ?? [];
}

/** Stable protected token persisted in the message body. */
export function skillReferenceToken(reference: ComposerSkillReference): string {
  return `[[skill:${reference.skillId}]]`;
}

/** Skill ids may be project-qualified paths; the closing bracket terminates the id. */
const SKILL_TOKEN_RE = /\[\[skill:[^\]]+\]\]/g;

export function stripSkillTokens(text: string): string {
  return text
    .replace(SKILL_TOKEN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Skill ids carried by the protected tokens in a persisted text, deduped, in order. */
export function skillTokenIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(SKILL_TOKEN_RE)) {
    const id = match[0].slice('[[skill:'.length, -']]'.length);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
