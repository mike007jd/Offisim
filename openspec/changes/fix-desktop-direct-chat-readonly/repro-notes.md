# Repro Notes

## 2026-04-21 release bundle repro

- Tauri release bundle direct chat to `Maya Lin` with `hi` immediately failed before any visible transport output with `Attempted to assign to readonly property.`.
- DevTools `Pause on exceptions` in Web Inspector did not stop on a useful source frame, so the app error surface was temporarily expanded to include the thrown stack.
- The first usable generated frame surfaced in the UI as:

```text
TypeError: Attempted to assign to readonly property.
$1@tauri://localhost/assets/vendor-llm-wroncPXR.js:317:18888
```

- Inspecting the built bundle at that location showed the offending generated statement:

```js
error = e;
error.pregelTaskId = pregelTask.id;
```

- That mapped to `@langchain/langgraph/dist/pregel/retry.js` in `_runWithRetry(...)`.
- Root cause classification: third-party runtime / SDK mutation of a caught error object. In Safari JavaScriptCore inside the Tauri webview, the caught `Error` can be readonly / non-extensible, so LangGraph's debug metadata write throws a new `TypeError` and masks the original failure.

## Adjacent issue discovered after readonly fix

- Once the LangGraph readonly crash was removed, direct chat progressed into the local orchestration repository and hit a SQLite constraint failure:

```text
CHECK constraint failed: status IN ('queued', 'running', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')
```

- Source audit showed local `task_runs` rows were being created with invalid statuses:
  - `employee-direct-setup-node.ts` used `pending`
  - `pm-planner/plan-persistence.ts` used `planned`
  - `pm-replan-node.ts` used `planned`
- These were normalized to `queued`, which matches the schema contract used by desktop SQLite.
