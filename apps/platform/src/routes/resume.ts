import { Hono } from 'hono';
import { requireLocalRuntimeAccess } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const resumeRoute = new Hono<PlatformEnv>();

resumeRoute.use('/api/conversations/*', requireLocalRuntimeAccess);

resumeRoute.get('/api/conversations/:id/resume', async (c) => {
  const conversationId = c.req.param('id');
  const coordinator = c.get('resumeCoordinator');
  const snapshot = coordinator ? await coordinator.resume(conversationId) : null;
  const payload = {
    conversationId,
    state: snapshot?.state ?? null,
    lastCheckpointTs: snapshot?.lastCheckpointTs ?? null,
    status: coordinator ? (snapshot ? 'ok' : 'not-found') : 'runtime-unavailable',
  };

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEvent('resume.snapshot', payload));
      controller.close();
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
