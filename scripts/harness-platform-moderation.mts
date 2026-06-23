// PL3 — a generic in-transaction failure during moderation must transition the
// job off `processing` (→ failed) and the draft back to a resubmittable `draft`,
// instead of stranding the job in `processing` forever (the claim gate only
// re-claims `pending`) with the draft stuck `submitted`.
//
// Verified by driving `processModerationJob` with a drizzle-shaped mock whose
// `transaction()` rejects, then asserting the recovery writes happened and the
// error was surfaced.

import { processModerationJob } from '../apps/platform/src/services/moderation.js';

type StatusWrite = Record<string, unknown>;

const SHA = 'a'.repeat(64);
// Minimal draft that passes validation + artifact-integrity + (no) lineage so the
// flow reaches `db.transaction(...)`, which is where the forced failure fires.
const VALID_DRAFT = {
  draft_id: 'draft-1',
  creator_id: 'creator-1',
  listing_id: null,
  status: 'submitted',
  title: 'Test Package',
  summary: 'A summary',
  kind: 'employee',
  validation_state: 'valid',
  validation_report: {
    artifact: {
      sha256: SHA,
      publisher_sha256: SHA,
      platform_sha256: SHA,
      size_bytes: 10,
      publisher_size_bytes: 10,
      platform_size_bytes: 10,
      registry_bytes_base64: 'AAAA',
    },
  },
  manifest_json: {
    package: { id: 'pkg-1', version: '1.0.0', summary: 'A summary', tags: [] },
    compatibility: { runtime_range: '*', schema_version: 1, supported_environments: [] },
    permissions: { risk_class: 'low' },
  },
};

// Records every `.set(values)` so the test can assert the status transitions
// without depending on drizzle table identity. The first claim UPDATE...returning
// yields the processing job once; the single pre-transaction SELECT yields the
// draft; `transaction()` rejects to simulate the generic in-tx failure.
function makeModerationMockDb() {
  const writes: StatusWrite[] = [];
  let claimed = false;
  const builder: Record<string, unknown> = {
    update() {
      return builder;
    },
    set(values: StatusWrite) {
      writes.push(values);
      return builder;
    },
    where() {
      return builder;
    },
    returning() {
      if (claimed) return Promise.resolve([]);
      claimed = true;
      return Promise.resolve([{ job_id: 'job-1', target_id: 'draft-1', status: 'processing' }]);
    },
    // Makes `await db.update(...).set(...).where(...)` (the non-returning writes)
    // resolve; the claim's `.returning()` and the `.limit()` selects use real
    // promises above, so this thenable is only hit by the bare-await writes.
    then(onF: unknown, onR: unknown) {
      return Promise.resolve(undefined).then(onF as never, onR as never);
    },
    select() {
      return builder;
    },
    from() {
      return builder;
    },
    limit() {
      return Promise.resolve([VALID_DRAFT]);
    },
    transaction() {
      return Promise.reject(new Error('forced in-tx failure'));
    },
  };
  return { db: builder, writes };
}

async function expectGenericFailureMarksJobFailedAndDraftResubmittable() {
  const { db, writes } = makeModerationMockDb();
  let threw = false;
  try {
    await processModerationJob(db as never, 'job-1');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('generic moderation failure did not surface (error was swallowed)');
  }
  const statuses = writes.map((w) => w.status);
  if (!statuses.includes('failed')) {
    throw new Error(`job was not transitioned to 'failed' (stuck processing). writes=${JSON.stringify(statuses)}`);
  }
  // The draft must be reset to a resubmittable 'draft' state, never left
  // 'submitted', and never marked 'approved'/'completed' on the failure path.
  if (!statuses.includes('draft')) {
    throw new Error(`draft was not reset to 'draft' for resubmission. writes=${JSON.stringify(statuses)}`);
  }
  if (statuses.includes('completed') || statuses.includes('approved')) {
    throw new Error(`failure path wrote a success status. writes=${JSON.stringify(statuses)}`);
  }
}

await expectGenericFailureMarksJobFailedAndDraftResubmittable();

console.log('Platform moderation failure-transition harness passed.');
