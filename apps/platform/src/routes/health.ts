import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';

const health = new Hono<PlatformEnv>();

health.get('/health', (c) => c.json({ status: 'ok' }));

export { health };
