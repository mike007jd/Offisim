import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
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
import { reviewsRoute } from './routes/reviews.js';
import { assertProxyTrustConfig, resolveCorsOrigins } from './startup.js';
import type { PlatformEnv } from './types.js';

export function createApp(platformDb: PlatformDb = db) {
  const corsOrigins = resolveCorsOrigins();
  // Warn (once, at app construction) if a production deployment behind a proxy
  // would silently collapse per-IP rate limiting. See assertProxyTrustConfig.
  assertProxyTrustConfig();
  const app = new Hono<PlatformEnv>();

  // Apply secureHeaders before cors so X-* defenders ride along with every
  // response. Hono's default set covers X-Content-Type-Options, X-Frame-Options
  // and Referrer-Policy among others (G/I10). This is a JSON API that serves no
  // HTML and embeds no resources, so we lock the CSP all the way down:
  // `default-src 'none'` denies every fetch/script/style/frame origin and
  // `frame-ancestors 'none'` forbids embedding the API in any frame
  // (clickjacking defence beyond the legacy X-Frame-Options).
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
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

  return app;
}
