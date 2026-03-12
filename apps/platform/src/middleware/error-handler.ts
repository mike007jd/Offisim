import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import type { PlatformEnv } from '../types.js';

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

  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  return c.json(
    {
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: status === 500 ? 'Internal server error' : err.message,
      },
    },
    status as any,
  );
};
