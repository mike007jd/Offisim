import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { db } from './db.js';

// ── Auth secret guard ──
const nodeEnv = process.env.NODE_ENV ?? 'development';
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!authSecret && nodeEnv === 'production') {
  console.error(
    '[startup] FATAL: BETTER_AUTH_SECRET is not set in production. ' +
      'Refusing to start with a default secret. ' +
      'Set BETTER_AUTH_SECRET to a strong random string (≥32 chars).',
  );
  process.exit(1);
} else if (!authSecret) {
  console.warn(
    '[startup] WARNING: BETTER_AUTH_SECRET is not set — using insecure default. ' +
      'This is acceptable for local development only.',
  );
}

/**
 * Better Auth instance for the AICS platform.
 *
 * Supports:
 * - Email/password authentication
 * - GitHub OAuth
 * - Google OAuth (optional — only if env vars are set)
 * - Bearer token plugin (for API/CLI access)
 * - Cookie-based sessions (SSR-compatible via credentials: 'include')
 *
 * Better Auth manages its own tables (user, session, account, verification).
 * We keep our existing `users` / `creators` tables and sync via hooks.
 */
export const auth = betterAuth({
  basePath: '/api/auth',
  secret: authSecret ?? 'aics-dev-secret-change-in-production',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4100',

  database: drizzleAdapter(db, {
    provider: 'pg',
  }),

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh once per day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes client-side cache
    },
  },

  plugins: [
    bearer(),
  ],

  trustedOrigins: (process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean)) ?? [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:1420',
  ],
});

export type Auth = typeof auth;
