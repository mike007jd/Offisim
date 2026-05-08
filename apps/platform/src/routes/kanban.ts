import type { KanbanOrigin, KanbanState } from '@offisim/shared-types';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireLocalRuntimeAccess } from '../middleware/auth.js';
import type { PlatformEnv, PlatformKanbanEvent } from '../types.js';

const encoder = new TextEncoder();
const KANBAN_ORIGIN_VALUES = [
  'pm-planner',
  'employee',
  'manager',
  'human',
] as const satisfies readonly KanbanOrigin[];
const KANBAN_STATE_VALUES = [
  'todo',
  'doing',
  'blocked',
  'review',
  'done',
] as const satisfies readonly KanbanState[];

const CreateCardSchema = z.object({
  title: z.string().trim().min(1),
  note: z.string().optional().nullable(),
  origin: z.enum(KANBAN_ORIGIN_VALUES),
  assignedEmployeeId: z.string().optional().nullable(),
  createdByEmployeeId: z.string().optional().nullable(),
});

const TransitionCardSchema = z.object({
  state: z.enum(KANBAN_STATE_VALUES),
  blockedReason: z.string().optional().nullable(),
});

export const kanbanRoute = new Hono<PlatformEnv>();

kanbanRoute.use('*', requireLocalRuntimeAccess);

kanbanRoute.get('/api/projects/:projectId/kanban', async (c) => {
  const store = requireKanbanStore(c);
  const cards = await store.listByProject(c.req.param('projectId'));
  return c.json({ cards });
});

kanbanRoute.post('/api/projects/:projectId/kanban', async (c) => {
  const store = requireKanbanStore(c);
  const body = CreateCardSchema.parse(await c.req.json());
  const card = await store.create(c.req.param('projectId'), body);
  return c.json({ card }, 201);
});

kanbanRoute.patch('/api/kanban/:id', async (c) => {
  const store = requireKanbanStore(c);
  const body = TransitionCardSchema.parse(await c.req.json());
  const card = await store.transition(c.req.param('id'), body.state, body.blockedReason);
  if (!card) {
    throw new HTTPException(404, { message: 'Kanban card not found' });
  }
  return c.json({ card });
});

kanbanRoute.get('/api/projects/:projectId/kanban/stream', (c) => {
  requireKanbanStore(c);
  const eventBus = c.get('kanbanEventBus');
  if (!eventBus) {
    throw new HTTPException(503, { message: 'Kanban event bus is not attached' });
  }
  const projectId = c.req.param('projectId');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEvent('kanban.ready', { projectId }));
      const unsubscribe = eventBus.on('kanban.', (event) => {
        if (!isKanbanEvent(event)) return;
        if (event.payload.card.project_id !== projectId) return;
        controller.enqueue(sseEvent(`kanban.card.${event.payload.op}`, event.payload));
      });
      c.req.raw.signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          controller.close();
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
});

kanbanRoute.get('/api/employees/:employeeId/kanban-count', async (c) => {
  const store = requireKanbanStore(c);
  const count = await store.countByEmployee(c.req.param('employeeId'));
  return c.json({ count });
});

function requireKanbanStore(
  c: Context<PlatformEnv>,
): NonNullable<PlatformEnv['Variables']['kanbanStore']> {
  const store = c.get('kanbanStore');
  if (!store) {
    throw new HTTPException(503, { message: 'Local kanban store is not attached' });
  }
  return store;
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isKanbanEvent(event: unknown): event is PlatformKanbanEvent {
  if (!event || typeof event !== 'object') return false;
  const payload = (event as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const card = record.card;
  return (
    record.kind === 'kanban' &&
    typeof record.op === 'string' &&
    card !== null &&
    typeof card === 'object' &&
    typeof (card as { project_id?: unknown }).project_id === 'string'
  );
}
