import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';

const health = new Hono<PlatformEnv>();

health.get('/health', async (c) => {
  const db = c.get('db');
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('[health] DB check failed:', err);
    return c.json({ status: 'degraded', db: 'unreachable' }, 503);
  }
});

export { health };
