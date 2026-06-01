import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { PlatformEnv } from '../types.js';

const PG_CONNECTION_ERROR_CODES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08P01',
  '28P01',
  '57P01',
  '57P02',
  '57P03',
]);

const CONN_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'CONNECTION_DESTROYED',
  'CONNECTION_CLOSED',
  'CONNECT_TIMEOUT',
  'CONNECTION_ENDED',
  'CONNECTION_CONNECT_TIMEOUT',
]);

function hasKnownDbConnectionCode(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) return false;
  const code = (err as { code?: unknown }).code;
  return (
    typeof code === 'string' && (PG_CONNECTION_ERROR_CODES.has(code) || CONN_ERROR_CODES.has(code))
  );
}

function isDbConnectionError(err: unknown): boolean {
  // postgres-js surfaces connection failures as flat errors carrying `.code`
  // (PG SQLSTATE or Node system code); it never wraps them in AggregateError
  // or a `.cause` chain, so a single code check is sufficient.
  return hasKnownDbConnectionCode(err);
}

export const errorHandler: ErrorHandler<PlatformEnv> = (err, c) => {
  // Zod validation errors → structured 400 with field-level details
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        },
      },
      400,
    );
  }

  console.error(`[${c.get('requestId')}] Unhandled error:`, err);

  if (isDbConnectionError(err)) {
    return c.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable',
        },
      },
      503,
    );
  }

  const status = (
    'status' in err && typeof err.status === 'number' ? err.status : 500
  ) as ContentfulStatusCode;
  return c.json(
    {
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: status === 500 ? 'Internal server error' : err.message,
      },
    },
    status,
  );
};
