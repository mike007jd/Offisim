import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { db } from './db.js';
import { seedOfficialResources } from './seed/official-seed.js';

const port = Number.parseInt(process.env.PORT ?? '4100', 10);
const baseUrl = process.env.PLATFORM_PUBLIC_URL ?? `http://localhost:${port}`;
const app = createApp();

// Fire-and-forget seed. The function already catches its own errors and
// logs at WARN; keeping it async means slow initial DB round-trips do not
// delay the HTTP listener coming up.
void seedOfficialResources(db, { baseUrl });

serve({ fetch: app.fetch, port }, () => {
  console.log(`Offisim Platform API listening on :${port}`);
});

export default app;
export { app };
