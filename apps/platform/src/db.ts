import * as schema from '@offisim/db-platform';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/offisim_platform';

const queryClient = postgres(DATABASE_URL);
export const db = drizzle(queryClient, { schema });
export type PlatformDb = typeof db;
