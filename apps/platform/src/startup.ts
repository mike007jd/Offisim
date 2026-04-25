export const DEV_AUTH_SECRET = 'offisim-dev-secret-change-in-production';

export const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5176',
  'http://localhost:1420',
  'tauri://localhost',
];

interface StartupConfigInput {
  authSecret?: string;
  nodeEnv?: string;
  rawCorsOrigins?: string;
}

export function resolveAuthSecret(input: StartupConfigInput = {}) {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const authSecret = input.authSecret ?? process.env.BETTER_AUTH_SECRET;

  if (!authSecret && nodeEnv === 'production') {
    throw new Error('BETTER_AUTH_SECRET is not set in production.');
  }

  return authSecret ?? DEV_AUTH_SECRET;
}

export function resolveCorsOrigins(input: StartupConfigInput = {}) {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const rawCorsOrigins = input.rawCorsOrigins ?? process.env.CORS_ORIGINS?.trim();

  if (rawCorsOrigins) {
    return rawCorsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  if (nodeEnv === 'production') {
    throw new Error('CORS_ORIGINS is not set in production.');
  }

  return DEV_DEFAULT_ORIGINS;
}
