import type { ErrorHandler } from 'hono';
import type { PlatformEnv } from '../types.js';

export const errorHandler: ErrorHandler<PlatformEnv> = (err, c) => {
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
