# LangGraph Fork Tracking

Last updated: 2026-05-02

## Local Fork

Offisim owns a local checkpoint saver fork at `apps/web/src/lib/tauri-checkpoint.ts`.

Baseline package family:

- `@langchain/langgraph@1.2.9`
- `@langchain/langgraph-checkpoint@1.0.1`
- `@langchain/langgraph-checkpoint-sqlite@1.0.1`

The local file is a Tauri async SQLite adaptation of the upstream SqliteSaver shape. It is not a vendored copy that should be blindly replaced during upgrades.

## Offisim-Owned Deltas

- Uses Tauri SQL (`getTauriDb()`) instead of `better-sqlite3` / Node-local SQLite.
- Converts LangGraph serializer `Uint8Array` payloads to strings before IPC storage because tauri-plugin-sql serializes JS values through JSON.
- Serializes write paths through a process-level async chain to avoid sqlx pool split-connection races.
- Writes checkpoint batches with single `INSERT OR REPLACE ... VALUES (...), (...)` statements instead of multi-call `BEGIN` / row insert / `COMMIT`.
- Keeps `deleteThread()` as two locked deletes without an explicit transaction because orphan `writes` rows are invisible when checkpoint anchor rows are gone.
- Logs write-path failures with `[tauri-checkpoint/<method>]` stack context.
- Hydrates legacy `currentStepOutputs[]` that predate contributor brand fields.

## pnpm Patch Relationship

`pnpm-workspace.yaml` patches `@langchain/langgraph@1.2.9` through `patches/@langchain__langgraph@1.2.9.patch`.

That patch is separate from `tauri-checkpoint.ts`. The patch only makes `pregel/retry` best-effort when attaching `pregelTaskId` to frozen/non-extensible errors. It does not own checkpoint persistence, SQLite access, or Tauri IPC behavior.

Upgrade rule:

- If an upgrade touches retry error metadata, inspect the pnpm patch first.
- If an upgrade touches checkpoint saver APIs, inspect `tauri-checkpoint.ts` against upstream SqliteSaver.
- Do not delete either one because the other exists.

## Quarterly Comparison Checklist

1. Check package versions in `packages/core/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
2. Compare upstream SqliteSaver / checkpoint saver APIs against `apps/web/src/lib/tauri-checkpoint.ts`.
3. Verify the local serializer/string conversion is still needed for tauri-plugin-sql IPC.
4. Verify `put`, `putWrites`, `deleteThread`, `getTuple`, `list`, and `loadLatest` still match LangGraph's expected method contracts.
5. Inspect `patches/@langchain__langgraph@1.2.9.patch`; refresh or remove it only if upstream no longer writes metadata unsafely.
6. Run deterministic replay and resume checks after any checkpoint change.
7. Update `openspec/protocols-ledger.md` if the fork status, package versions, or patch rationale changes.
