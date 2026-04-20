# tauri-checkpoint-serialization Specification

## Purpose
TBD - created by archiving change fix-tauri-checkpoint-serial-writer. Update Purpose after archive.
## Requirements
### Requirement: `TauriCheckpointSaver` write ops avoid explicit multi-call transactions

`TauriCheckpointSaver.putWrites` and `TauriCheckpointSaver.deleteThread` SHALL NOT wrap multiple `db.execute` calls in a manual `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` scaffold. The underlying `@tauri-apps/plugin-sql` `Database.execute` transport (sqlx `SqlitePool`) does not pin a connection across successive calls; splitting a logical transaction across execute calls can land on different pool connections, leaving `BEGIN` orphaned on one connection and producing `error returned from database: (code: 1) cannot rollback - no transaction is active` + `error returned from database: (code: 5) database is locked` under concurrent writer pressure. Atomicity SHALL instead be achieved by (a) single `db.execute` calls carrying all mutations the method requires, or (b) designs where independent mutations are each individually safe to fail (orphan rows not visible through any read path).

#### Scenario: `putWrites` persists all channel writes in a single execute

- **WHEN** `putWrites(config, writes, taskId)` is invoked with `writes.length === N` (N ≥ 1)
- **THEN** the saver SHALL emit exactly one `db.execute(sql, params)` call whose SQL is `INSERT OR REPLACE INTO writes (cols) VALUES (...), (...), ... (N tuples)` and `params` is the flat ordered list of N × 8 bound values
- **AND** no `BEGIN IMMEDIATE`, `COMMIT`, or `ROLLBACK` statements SHALL be issued

#### Scenario: `deleteThread` does not use explicit transaction

- **WHEN** `deleteThread(threadId)` is invoked
- **THEN** the saver SHALL emit two sequential `db.execute` calls: first `DELETE FROM checkpoints WHERE thread_id = $1`, then `DELETE FROM writes WHERE thread_id = $1`
- **AND** no `BEGIN` / `COMMIT` / `ROLLBACK` SHALL be issued

#### Scenario: Orphan writes after partial delete are invisible

- **WHEN** `deleteThread(tid)` runs and the second DELETE (on `writes`) fails after the first DELETE (on `checkpoints`) succeeds
- **THEN** a subsequent `getTuple({thread_id: tid, ...})` SHALL return `undefined` (no checkpoint row exists to JOIN against, so orphan `writes` rows remain invisible in the read path)
- **AND** the read path SHALL NOT produce corrupted or partial checkpoints

### Requirement: Checkpoint writes are serialized by a process-level async mutex

All `TauriCheckpointSaver` write methods (`put`, `putWrites`, `deleteThread`) SHALL execute inside a shared process-level async promise chain that guarantees at most one checkpoint write is in flight against the SQLite pool at any moment. The mutex SHALL be implemented as a module-local `writeChain` variable plus a `run<T>(fn)` helper that appends each call to the chain and swallows prior errors so a failed write does not permanently poison the chain. Read operations (`getTuple`, `list`, internal SELECTs) SHALL NOT enter the mutex — WAL mode preserves concurrent reads while writes are serialized.

#### Scenario: Concurrent `putWrites` invocations are serialized

- **WHEN** two `TauriCheckpointSaver.putWrites` calls are fired back-to-back without awaiting the first
- **THEN** the second call's `db.execute` SHALL only run after the first call's `db.execute` has resolved (success or failure)
- **AND** under no circumstance SHALL two writes be in flight in the pool simultaneously

#### Scenario: A failed write does not poison subsequent writes

- **WHEN** one `putWrites` call rejects with an IO error
- **THEN** the next queued write (e.g. a subsequent `put`) SHALL still execute normally
- **AND** its completion SHALL NOT be blocked by the prior error

#### Scenario: Reads remain concurrent with writes

- **WHEN** a `putWrites` is in the mutex and a `getTuple` is called on a different thread
- **THEN** the `getTuple` `db.select` SHALL proceed without waiting for the mutex (no read-side serialization)

### Requirement: Write-path errors carry stack traces to DevTools

`TauriCheckpointSaver.put`, `putWrites`, and `deleteThread` SHALL wrap their main logic in a try/catch block whose catch arm invokes `console.error('[tauri-checkpoint/<method>]', err.stack ?? err.message)` before re-throwing. This preserves LangGraph's existing error propagation (the saver still rejects the promise) while ensuring the Tauri DevTools console receives a stack that names the failing method, for live-verify diagnosis and future drift detection.

#### Scenario: putWrites IO failure logs stack

- **WHEN** `putWrites` fails with a SQLite error
- **THEN** a single `console.error` call SHALL fire with a message beginning `[tauri-checkpoint/putWrites]` followed by the thrown error's stack (or message if stack is absent)
- **AND** the caller promise SHALL still reject with the original error unchanged

