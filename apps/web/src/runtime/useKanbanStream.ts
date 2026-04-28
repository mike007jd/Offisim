import { isTauri } from '@offisim/ui-office/web';
import type { Dispatch } from 'react';
import { useCallback, useEffect, useReducer, useState } from 'react';
import type {
  CreateKanbanCardInput,
  KanbanCard,
  KanbanOrigin,
  KanbanState,
} from '../components/workspaces/kanban/types';

type RawKanbanCard = Partial<Record<string, unknown>>;
type KanbanUpdatePayload = { op?: string; card?: RawKanbanCard };
type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

type CardsAction =
  | { type: 'replace'; cards: KanbanCard[] }
  | { type: 'upsert'; card: KanbanCard }
  | { type: 'clear' };

export interface UseKanbanStreamResult {
  cards: KanbanCard[];
  loading: boolean;
  error: string | null;
  move: (id: string, next: KanbanState, blockedReason?: string | null) => Promise<void>;
  create: (input: CreateKanbanCardInput) => Promise<void>;
}

export function useKanbanStream(projectId: string | null | undefined): UseKanbanStreamResult {
  const [cards, dispatch] = useReducer(cardsReducer, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      dispatch({ type: 'clear' });
      setLoading(false);
      setError(null);
      return;
    }

    const activeProjectId = projectId;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    setLoading(true);
    setError(null);

    async function start() {
      try {
        if (isTauri()) {
          cleanup = await startTauriStream(activeProjectId, dispatch);
        } else {
          cleanup = await startWebStream(activeProjectId, dispatch);
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void start();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [projectId]);

  const move = useCallback(async (id: string, next: KanbanState, blockedReason?: string | null) => {
    const card = isTauri()
      ? await transitionViaTauri(id, next, blockedReason)
      : await transitionViaWeb(id, next, blockedReason);
    if (card) dispatch({ type: 'upsert', card });
  }, []);

  const create = useCallback(
    async (input: CreateKanbanCardInput) => {
      if (!projectId) return;
      const origin: KanbanOrigin = input.origin ?? 'human';
      const card = isTauri()
        ? await createViaTauri(projectId, { ...input, origin })
        : await createViaWeb(projectId, { ...input, origin });
      dispatch({ type: 'upsert', card });
    },
    [projectId],
  );

  return { cards, loading, error, move, create };
}

function cardsReducer(cards: KanbanCard[], action: CardsAction): KanbanCard[] {
  switch (action.type) {
    case 'replace':
      return sortCards(action.cards);
    case 'upsert': {
      const next = new Map(cards.map((card) => [card.id, card]));
      next.set(action.card.id, action.card);
      return sortCards([...next.values()]);
    }
    case 'clear':
      return [];
  }
}

async function startWebStream(
  projectId: string,
  dispatch: Dispatch<CardsAction>,
): Promise<() => void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/kanban`);
  if (!res.ok) throw new Error(`Kanban list failed: ${res.status}`);
  const payload = (await res.json()) as { cards?: RawKanbanCard[] };
  dispatch({ type: 'replace', cards: (payload.cards ?? []).map(normalizeCard) });

  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/kanban/stream`);
  const handler = (event: MessageEvent<string>) => {
    const update = JSON.parse(event.data) as KanbanUpdatePayload;
    if (update.card) dispatch({ type: 'upsert', card: normalizeCard(update.card) });
  };
  source.addEventListener('kanban.card.created', handler);
  source.addEventListener('kanban.card.transitioned', handler);
  source.addEventListener('kanban.card.assigned', handler);
  source.onerror = () => {
    source.close();
  };
  return () => source.close();
}

async function startTauriStream(
  projectId: string,
  dispatch: Dispatch<CardsAction>,
): Promise<() => void> {
  const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
  const { listen } = (await import('@tauri-apps/api/event')) as { listen: ListenFn };
  const rawCards = await invoke<RawKanbanCard[]>('list_kanban_cards', { projectId });
  dispatch({ type: 'replace', cards: rawCards.map(normalizeCard) });
  return listen<KanbanUpdatePayload>(`kanban://updates/${projectId}`, (event) => {
    if (event.payload.card) dispatch({ type: 'upsert', card: normalizeCard(event.payload.card) });
  });
}

async function createViaWeb(
  projectId: string,
  input: CreateKanbanCardInput & { origin: KanbanOrigin },
): Promise<KanbanCard> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/kanban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Kanban create failed: ${res.status}`);
  const payload = (await res.json()) as { card?: RawKanbanCard };
  return normalizeCard(requireCard(payload.card));
}

async function createViaTauri(
  projectId: string,
  input: CreateKanbanCardInput & { origin: KanbanOrigin },
): Promise<KanbanCard> {
  const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
  const card = await invoke<RawKanbanCard>('create_kanban_card', {
    input: { ...input, projectId },
  });
  return normalizeCard(card);
}

async function transitionViaWeb(
  id: string,
  next: KanbanState,
  blockedReason?: string | null,
): Promise<KanbanCard | null> {
  const res = await fetch(`/api/kanban/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: next, blockedReason: blockedReason ?? null }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Kanban transition failed: ${res.status}`);
  const payload = (await res.json()) as { card?: RawKanbanCard };
  return normalizeCard(requireCard(payload.card));
}

async function transitionViaTauri(
  id: string,
  next: KanbanState,
  blockedReason?: string | null,
): Promise<KanbanCard | null> {
  const { invoke } = (await import('@tauri-apps/api/core')) as { invoke: InvokeFn };
  const card = await invoke<RawKanbanCard | null>('transition_kanban_card', {
    id,
    next,
    reason: blockedReason ?? null,
  });
  return card ? normalizeCard(card) : null;
}

function requireCard(card: RawKanbanCard | undefined): RawKanbanCard {
  if (!card) throw new Error('Kanban response did not include a card');
  return card;
}

function normalizeCard(raw: RawKanbanCard): KanbanCard {
  return {
    id: stringField(raw, 'id'),
    projectId: stringField(raw, 'project_id', 'projectId'),
    companyId: stringField(raw, 'company_id', 'companyId'),
    title: stringField(raw, 'title'),
    note: stringField(raw, 'note', undefined, ''),
    state: stringField(raw, 'state') as KanbanState,
    origin: stringField(raw, 'origin') as KanbanOrigin,
    createdByEmployeeId: nullableStringField(raw, 'created_by_employee_id', 'createdByEmployeeId'),
    assignedEmployeeId: nullableStringField(raw, 'assigned_employee_id', 'assignedEmployeeId'),
    parentCardId: nullableStringField(raw, 'parent_card_id', 'parentCardId'),
    blockedReason: nullableStringField(raw, 'blocked_reason', 'blockedReason'),
    taskRunId: nullableStringField(raw, 'task_run_id', 'taskRunId'),
    sortOrder: numberField(raw, 'sort_order', 'sortOrder'),
    createdAt: stringField(raw, 'created_at', 'createdAt'),
    updatedAt: stringField(raw, 'updated_at', 'updatedAt'),
  };
}

function sortCards(cards: KanbanCard[]): KanbanCard[] {
  return [...cards].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function stringField(
  raw: RawKanbanCard,
  snakeKey: string,
  camelKey?: string,
  fallback = '',
): string {
  const value = raw[snakeKey] ?? (camelKey ? raw[camelKey] : undefined);
  return typeof value === 'string' ? value : fallback;
}

function nullableStringField(
  raw: RawKanbanCard,
  snakeKey: string,
  camelKey: string,
): string | null {
  const value = raw[snakeKey] ?? raw[camelKey];
  return typeof value === 'string' ? value : null;
}

function numberField(raw: RawKanbanCard, snakeKey: string, camelKey: string): number {
  const value = raw[snakeKey] ?? raw[camelKey];
  return typeof value === 'number' ? value : 0;
}
