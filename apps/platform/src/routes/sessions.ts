import {
  DEFAULT_INTERACTION_MODE,
  type InteractionMode,
  isInteractionMode,
} from '@offisim/shared-types';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireLocalRuntimeAccess } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const SessionModeSchema = z.object({
  mode: z.enum(['boss_proxy', 'human_in_loop', 'direct_to_employee', 'yolo']),
});

export const sessionsRoute = new Hono<PlatformEnv>();

sessionsRoute.use('/api/sessions/*', requireLocalRuntimeAccess);

sessionsRoute.get('/api/sessions/:id', async (c) => {
  const sessionStore = c.get('sessionStore');
  if (!sessionStore) {
    throw new HTTPException(503, { message: 'Local session store is not attached' });
  }
  const session = await sessionStore.getSession(c.req.param('id'));
  if (!session) {
    throw new HTTPException(404, { message: 'Session not found' });
  }
  return c.json({ session: { ...session, mode: normalizeMode(session.mode) } });
});

sessionsRoute.patch('/api/sessions/:id/mode', async (c) => {
  const sessionStore = c.get('sessionStore');
  if (!sessionStore) {
    throw new HTTPException(503, { message: 'Local session store is not attached' });
  }
  const body = SessionModeSchema.parse(await c.req.json());
  const session = await sessionStore.setSessionMode(c.req.param('id'), body.mode);
  if (!session) {
    throw new HTTPException(404, { message: 'Session not found' });
  }
  return c.json({ ok: true, mode: normalizeMode(session.mode), session });
});

function normalizeMode(mode: InteractionMode): InteractionMode {
  return isInteractionMode(mode) ? mode : DEFAULT_INTERACTION_MODE;
}
