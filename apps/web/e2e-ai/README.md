# Web AI E2E Tests

This directory holds browser-level AI behavior tests for `apps/web`.

- Run from the repo root with `pnpm test:ai`.
- `playwright.config.ai.ts` is isolated from the regular and prod E2E configs.
- The suite uses a real MiniMax key from `.env.local`; it never mocks the LLM.
- If `MINIMAX_API_KEY` is missing, the suite skips in `beforeAll`.
- Keep each Playwright AI test at `>= 120_000ms`.

Add new tests here when the behavior requires the browser runtime, UI rendering, or local storage seeding.
