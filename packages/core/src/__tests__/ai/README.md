# AI Runtime Tests

This directory holds live MiniMax-backed AI behavior tests for `@offisim/core`.

- Run from the repo root with `pnpm test:ai`.
- These tests never mock the LLM.
- If `MINIMAX_API_KEY` is missing from `.env.local`, the suite skips cleanly.
- Keep each AI test at `>= 60_000ms` because real provider latency is variable.

Add new tests here when you can instantiate the runtime directly in Node without a browser.
