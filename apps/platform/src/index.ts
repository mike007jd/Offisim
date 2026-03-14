import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from './db.js';
import { optionalAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';
import { authRoute } from './routes/auth.js';
import { creatorsRoute } from './routes/creators.js';
import { health } from './routes/health.js';
import { installRoute } from './routes/install.js';
import { market } from './routes/market.js';
import { meRoute } from './routes/me.js';
import { publish } from './routes/publish.js';
import { reviewsRoute } from './routes/reviews.js';
import type { PlatformEnv } from './types.js';

const app = new Hono<PlatformEnv>();

// Global middleware — read allowed origins from env, fallback to '*' in dev
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['*'];
app.use(
  '*',
  cors({
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
  }),
);
app.use('*', requestId);
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});
app.use('*', optionalAuth);
app.onError(errorHandler);

// Routes
app.route('/', health);
app.route('/v1/auth', authRoute);
app.route('/v1/market', market);
app.route('/v1/market/creators', creatorsRoute);
app.route('/v1/reviews', reviewsRoute);
app.route('/v1/publish', publish);
app.route('/v1/install', installRoute);
app.route('/v1/me', meRoute);

const port = Number.parseInt(process.env.PORT ?? '4100', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`AICS Platform API listening on :${port}`);
});

export default app;
export { app };
