## 1. Failed Retry State

- [x] 1.1 Audit the current web retry path in `useRuntimeInit`, `OffisimRuntimeProvider`, and `ChatPanel`, and identify which state must survive runtime reinit versus which state should remain transient display-only — confirmed root cause: `lastFailedMessageRef` survived reinit, but the chat rail only rendered retry UI from bare `error`, so runtime reinit could leave retry metadata alive while removing the visible `Retry` banner
- [x] 1.2 Introduce a structured failed-run retry state in the web runtime layer so retryable error metadata survives `reinitRuntime()` within the same page session
- [x] 1.3 Update retry / dismiss / new-send clearing rules so runtime reinit alone does not remove the failed-run retry affordance

## 2. Chat UI Integration

- [x] 2.1 Expose the failed-run retry state through the runtime context without leaking internal refs into UI components
- [x] 2.2 Update `ChatPanel` / `ErrorBanner` to render `Retry` from the new failed-run state and keep existing direct-chat target routing semantics intact
- [x] 2.3 Verify adjacent actions (`Swap Person`, `Swap Model`, dismiss) still behave coherently when a failed run survives runtime reinit — 2026-04-22 web live confirmed: after reinit the banner still showed `Swap Person` / `Swap Model`; dismiss removed the banner; `Swap Model` still opened Settings; `Swap Person` cleared the banner and re-dispatched the task to Alex (`1 employees active`, `Alex Chen executing`)

## 3. Verification

- [x] 3.1 Run `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/web build`
- [x] 3.2 Web live verify: 2026-04-22 / local Vite dev on `http://localhost:4173` — forced a retryable failure with `baseURL=http://127.0.0.1:1/v1`, then repaired the provider config through Settings so `reinitRuntime()` ran; after returning to Office, the failed run still showed a visible `Retry` affordance plus `Swap Person` / `Swap Model`
- [x] 3.3 Web live verify: 2026-04-22 / local Vite dev on `http://localhost:4173` — after reinit, clicked the preserved `Retry` affordance and confirmed the retried run reused the original failed-run metadata rather than appending a new user send: the prompt count stayed `1` before and after retry, while the token response appeared in the same conversation
