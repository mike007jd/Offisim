import * as schema from '@offisim/db-platform';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/offisim_platform';

// G/I6: bound the postgres pool so a Postgres restart or a runaway client
// doesn't pile up sockets in CLOSE_WAIT until the file descriptor limit hits.
// `max` matches the prior default; `idle_timeout` aggressively recycles idle
// peers; `connect_timeout` keeps a misbehaving DB from hanging the request.
const queryClient = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});
export const db = drizzle(queryClient, { schema });
export type PlatformDb = typeof db;
