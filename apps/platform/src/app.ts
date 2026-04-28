import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth.js';
import { db } from './db.js';
import type { PlatformDb } from './db.js';
import { optionalAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRateLimit, generalRateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { authRoute } from './routes/auth.js';
import { creatorsRoute } from './routes/creators.js';
import { health } from './routes/health.js';
import { installRoute } from './routes/install.js';
import { market } from './routes/market.js';
import { meRoute } from './routes/me.js';
import { publish } from './routes/publish.js';
import { resumeRoute } from './routes/resume.js';
import { reviewsRoute } from './routes/reviews.js';
import { resolveCorsOrigins } from './startup.js';
import type { PlatformEnv } from './types.js';

export function createApp(
  platformDb: PlatformDb = db,
  opts?: { resumeCoordinator?: PlatformEnv['Variables']['resumeCoordinator'] },
) {
  const corsOrigins = resolveCorsOrigins();
  const app = new Hono<PlatformEnv>();

  app.use(
    '*',
    cors({
      origin: corsOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    }),
  );
  app.use('*', requestId);
  app.use('*', generalRateLimit);
  app.use('*', async (c, next) => {
    c.set('db', platformDb);
    if (opts?.resumeCoordinator) {
      c.set('resumeCoordinator', opts.resumeCoordinator);
    }
    await next();
  });
  app.use('/api/auth/*', authRateLimit);
  app.use('*', optionalAuth);
  app.onError(errorHandler);

  app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  app.route('/', health);
  app.route('/v1/auth', authRoute);
  app.route('/v1/market', market);
  app.route('/v1/market/creators', creatorsRoute);
  app.route('/v1/reviews', reviewsRoute);
  app.route('/v1/publish', publish);
  app.route('/v1/install', installRoute);
  app.route('/v1/me', meRoute);
  app.route('/', resumeRoute);

  return app;
}
