import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '4100', 10);
const app = createApp();

serve({ fetch: app.fetch, port }, () => {
  console.log(`Offisim Platform API listening on :${port}`);
});

export default app;
export { app };
