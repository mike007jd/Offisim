import { baAccount, baSession, baUser, baVerification } from '@offisim/db-platform';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { db } from './db.js';
import { resolveAuthBaseUrl, resolveAuthSecret, resolveCorsOrigins } from './startup.js';

const authSecret = resolveAuthSecret();

/**
 * Better Auth instance for the Offisim platform.
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
  secret: authSecret,
  baseURL: resolveAuthBaseUrl(),

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: baUser,
      session: baSession,
      account: baAccount,
      verification: baVerification,
    },
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

  plugins: [bearer()],

  trustedOrigins: resolveCorsOrigins(),
});

export type Auth = typeof auth;
