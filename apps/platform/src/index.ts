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

// ── CORS configuration ──

const nodeEnv = process.env.NODE_ENV ?? 'development';
const rawCorsOrigins = process.env.CORS_ORIGINS?.trim();

const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:1420',
];

let corsOrigins: string[];

if (rawCorsOrigins) {
  // Explicit whitelist provided — use it
  corsOrigins = rawCorsOrigins.split(',').map((o) => o.trim()).filter(Boolean);
} else if (nodeEnv === 'production') {
  // Production without explicit CORS_ORIGINS — refuse to start with wildcard
  console.error(
    '[startup] FATAL: CORS_ORIGINS is not set in production. ' +
      'Refusing to start with wildcard CORS. ' +
      'Set CORS_ORIGINS to a comma-separated list of allowed origins.',
  );
  process.exit(1);
} else {
  // Development default — common local dev ports
  corsOrigins = DEV_DEFAULT_ORIGINS;
}

console.log(`[startup] CORS origins: ${corsOrigins.join(', ')}`);

const app = new Hono<PlatformEnv>();

// Global middleware
app.use(
  '*',
  cors({
    origin: corsOrigins,
    credentials: true,
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
