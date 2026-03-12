import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import type { PlatformEnv } from './types.js';
import { db } from './db.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { optionalAuth } from './middleware/auth.js';
import { health } from './routes/health.js';

const app = new Hono<PlatformEnv>();

// Global middleware
app.use('*', cors({ origin: '*' })); // Tighten in production
app.use('*', requestId);
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});
app.use('*', optionalAuth);
app.onError(errorHandler);

// Routes
app.route('/', health);
// Chunk B will add: app.route('/v1/market', market);
// Chunk B will add: app.route('/v1', reviews);
// Chunk D will add: app.route('/v1/publish', publish);

const port = parseInt(process.env.PORT ?? '4100', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`AICS Platform API listening on :${port}`);
});

export default app;
export { app };
