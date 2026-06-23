# Storage Consistency Contracts (frozen — Wave 0)

> Frozen by the GPT-5.5 audit remediation loop (`.ai/loops/gpt55-audit-remediation.md`),
> Wave 0. These are the shared rules every storage mutation in the remediation must
> satisfy. They are oracles, not aspirations: the Wave 0 contract harness
> (`scripts/harness-workspace-repo-contract.mts`) enforces the tenant-boundary rule
> against *both* SQLite backends, and Wave 2 FS deletion paths apply the ordering rule.

## C-A — Tenant boundary (company/project-scoped mutations)

**Rule.** Any mutation that targets a row owned by a company (or project) MUST scope
its `WHERE` clause by the owner id in addition to the row id, and MUST treat
"no row matched" as a failure, not a silent no-op:

```
UPDATE/DELETE ... WHERE <row_id> = ? AND company_id = ?
-- then assert changes === 1 (or throw / reject)
```

**Why.** Two SQLite backends back the same repositories — `better-sqlite3`
(`packages/core/src/runtime/repos/**/drizzle.ts`, sync, real transactions) and
`sqlite-proxy` (`apps/desktop/renderer/src/lib/tauri-repos/**`, async, serialized by
the `withTauriSqlTransaction` write-mutex). A mutation that filters only by row id:

- can cross-tenant write (activate / mutate another company's row), and
- can silently match zero rows and leave the owner in an inconsistent state
  (e.g. zero active office layouts after a bad `setActive`).

**Canonical violation (O1).** `officeLayouts.setActive(companyId, layoutId)`:
the core backend wraps both writes in `db.transaction`, scopes the activate write by
`AND company_id = ?`, and throws when `changes === 0`. The Tauri backend (pre-fix) did
two un-scoped, un-transactional `await` writes — so a foreign or non-existent
`layoutId` deactivates every layout of `companyId` and activates nothing (or activates
a foreign row). The contract harness pins this drift.

**Single-active invariant (specialization for `office_layouts`).** After any successful
`setActive`, a company has **exactly one** active layout; after a rejected `setActive`
(foreign / non-existent id), the company's prior active layout is **unchanged**.

**Backend-appropriate atomicity.** The core (better-sqlite3) backend wraps both writes
in a real `db.transaction` with the existence check inside, rolling back on a miss.
The Tauri (sqlite-proxy) backend follows the renderer convention that repo *methods*
issue standalone writes (cross-method atomicity is composed by callers via
`asyncTransact`, not inside a method). O1 therefore fixes the Tauri `setActive` by
checking the layout exists for the company **before any write** and throwing on a miss —
so a rejected call mutates nothing — then deactivating + activating under the company
scope, serialized by the `withTauriSqlTransaction` write mutex. Both backends satisfy
the single-active invariant above; the contract harness asserts the observable
behavior, not the mechanism.

**Reusable oracle.** `scripts/lib/audit-storage-contracts.mts` exports the assertions
(`assertExactlyOneActive`, `runOfficeLayoutSetActiveContract`). New company/project
mutations added by this loop must keep these green on both backends.

## C-B — FS↔DB ordering (rows-first, FS best-effort)

**Rule.** When a delete/cleanup spans the SQLite DB and the filesystem
(attachments, vault, workspace dirs), the **DB transaction commits first**; the
filesystem cleanup is **best-effort afterward**:

1. Delete the owning DB rows in a single transaction (atomic). If it fails, abort —
   nothing was removed, no dangling references.
2. Only after the DB commit succeeds, remove the FS blobs
   (`attachments/<companyId>`, vault dirs, etc.). An FS failure here leaves
   **orphans** (collectible later by a GC pass), never **dangling references**
   (a DB row pointing at a deleted blob, or a blob the DB still believes is live).

**Why.** The reverse order (FS first, then DB) can delete a blob and then fail the DB
write, leaving a live DB row whose blob is gone — an unrecoverable dangling reference
visible to the user as corruption. Orphaned blobs are merely wasted disk and are
safe to sweep.

**Applied in.** Wave 2 — C1 (company delete also removes `attachments/<companyId>`),
C2 (conversation delete = DB txn first, then best-effort attachment FS cleanup),
C3 (company-from-template create is transactional / compensating).

**Asymmetry note.** Create is the mirror image: create DB rows transactionally; if a
later step fails, compensate by removing what was provisioned. The invariant is the
same — the DB is the source of truth, the FS is reconciled to it.
