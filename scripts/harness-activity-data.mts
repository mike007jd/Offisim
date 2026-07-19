/**
 * Office Board Timeline data-layer gate (audit items AC1 + AC2).
 *
 * AC2 — secret redaction + size cap: feed an args object carrying real-looking
 * secrets and an oversized blob through `sanitizeMcpActivityValue`, assert the
 * secrets become `[REDACTED]` and the oversized value is capped + marked
 * truncated. Also exercise `redactSecrets` over the individual token shapes.
 *
 * AC1 — cursor pagination merge: seed >pageSize rows for one source, assert the
 * merged page 1 returns the newest `pageSize` rows plus a `nextCursor`, and that
 * page 2 (fetched with that cursor applied to the source query) returns the
 * older rows.
 *
 * Pure Node via tsx against the renderer source — the exported helpers carry no
 * DOM/Tauri side effects, so they import and run under plain tsx.
 */
import type {
  ActivityPayloadValue,
  ActivityRecord,
  ActivitySourcePage,
} from '../apps/desktop/renderer/src/data/board/activity-data.js';
import {
  MAX_MCP_VALUE_CHARS,
  displayActorName,
  meetingRecordFromRow,
  mergeActivityPage,
  redactSecrets,
  sanitizeMcpActivityValue,
} from '../apps/desktop/renderer/src/data/board/activity-data.js';
import {
  checkpointPathForDisplay,
  getDisplaySummary,
} from '../apps/desktop/renderer/src/surfaces/office/board/activity-presentation.js';
import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();
const { check } = h;

const meeting = meetingRecordFromRow({
  meeting_id: 'meeting-1',
  thread_id: 'company-thread-1',
  topic: 'Launch review',
  status: 'scheduled',
  summary_json: '{"participants":["employee-1"]}',
  created_at: '2026-07-12T09:30:00.000Z',
});
check('meeting source keeps title', meeting.entity?.label === 'Launch review');
check('meeting source keeps a display time', typeof meeting.payload?.timeLabel === 'string');
check('meeting source is timeline-addressable', meeting.type === 'meeting.scheduled');

console.log('Timeline copy — checkpoint, rewind, and worktree activity');
{
  const checkpoint = getDisplaySummary({
    id: 'checkpoint-1',
    type: 'workspace.checkpoint',
    at: Date.now(),
    actor: 'Sophie',
    payload: { employeeRole: 'Developer', step: 2, changedPaths: ['src/app.ts'] },
  });
  check('checkpoint headline names the employee', checkpoint.actor === 'Sophie');
  check(
    'checkpoint headline explains role, step, and file count',
    checkpoint.label === 'Developer · saved a change checkpoint · Step 2 · 1 file',
    checkpoint.label,
  );
  check('checkpoint headline contains no machine id', !checkpoint.label.includes('checkpoint-'));
  check(
    'unresolved run id falls back to a human actor label',
    displayActorName('run-6a3f8f98-2d94-44be-92f3-8aac7ae92c99') === 'Employee',
  );
  check('API engine actor uses product language', displayActorName('api') === 'Assistant');
  check(
    'checkpoint file path is project-relative',
    checkpointPathForDisplay('/tmp/project/src/app.ts', '/tmp/project') === 'src/app.ts',
  );
  check(
    'unexpected absolute path degrades to a filename',
    checkpointPathForDisplay('/private/elsewhere/secret.txt', '/tmp/project') === 'secret.txt',
  );

  const rollback = getDisplaySummary({
    id: 'rollback-1',
    type: 'workspace.checkpoint.rollback',
    at: Date.now(),
    actor: 'You',
    payload: { targetStep: 2 },
  });
  check(
    'rewind headline is a plain-language action',
    rollback.actor === 'You' && rollback.label === 'rolled back to Step 2',
    `${rollback.actor} · ${rollback.label}`,
  );

  const snapshot = getDisplaySummary({
    id: 'snapshot-1',
    type: 'agent.workspace.lease.snapshot',
    at: Date.now(),
    actor: 'Sophie',
    payload: { employeeRole: 'Developer', phase: 'verified' },
  });
  check(
    'worktree snapshot copy uses the same human voice',
    snapshot.label === 'Developer · verified workspace changes',
    snapshot.label,
  );

  const failedWrite = getDisplaySummary({
    id: 'tool-1',
    type: 'agent.conversation.run.tool',
    at: Date.now(),
    actor: displayActorName('api'),
    payload: { toolName: 'write', status: 'failed' },
  });
  check(
    'engine tool failure explains the attempted action',
    failedWrite.actor === 'Assistant' && failedWrite.label === 'tried to update a project file',
    `${failedWrite.actor} · ${failedWrite.label}`,
  );
}

/* ── AC2: redaction over individual token shapes ───────────────────────────── */
console.log('AC2 redactSecrets — token shapes');
{
  const cases: ReadonlyArray<[string, string]> = [
    ['key sk-abcdefghijklmnopqrstuvwx', 'sk- provider key'],
    ['key rk-ABCDEFGHIJKLMNOP1234567', 'rk- restricted key'],
    ['ghp_0123456789abcdefghij0123', 'GitHub PAT (ghp_)'],
    ['gho_0123456789abcdefghij0123', 'GitHub OAuth (gho_)'],
    ['github_pat_0123456789abcdefghij0123', 'fine-grained GitHub PAT'],
    ['xoxb-1234567890-abcdefghij', 'Slack bot token'],
    ['AKIAIOSFODNN7EXAMPLE', 'AWS access key id'],
    [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'JWT',
    ],
  ];
  for (const [input, label] of cases) {
    const out = redactSecrets(input);
    check(
      `${label} → [REDACTED]`,
      out.includes('[REDACTED]') && !out.includes(input.split(' ').pop() ?? ''),
      out,
    );
  }

  const url = redactSecrets('clone https://alice:s3cr3t@github.com/acme/repo.git');
  check(
    'URL credentials masked, scheme+host kept',
    url === 'clone https://[REDACTED]@github.com/acme/repo.git',
    url,
  );

  const kv = redactSecrets('Authorization: Bearer abc.def password=hunter2 api_key=ABCDEF');
  check('Authorization value masked', /Authorization:\s*\[REDACTED\]/i.test(kv), kv);
  check('password value masked', /password=\[REDACTED\]/i.test(kv), kv);
  check('api_key value masked', /api_key=\[REDACTED\]/i.test(kv), kv);
}

/* ── AC2: structured sanitize + size cap (the prompt oracle) ───────────────── */
console.log('AC2 sanitizeMcpActivityValue — recursive redact + cap');
{
  const args: Record<string, ActivityPayloadValue> = {
    command: 'curl -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwx"',
    key: 'ghp_0123456789abcdefghij0123',
    nested: { token: 'xoxp-9876543210-fedcba9876', note: 'fine' },
    list: ['plain', 'sk-zyxwvutsrqponmlkjihgfedcba'],
  };
  const sanitized = sanitizeMcpActivityValue(args);
  const serialized = JSON.stringify(sanitized);
  check(
    'structured value stays an object (not capped)',
    typeof sanitized === 'object' && sanitized !== null,
  );
  check('command secret redacted', !serialized.includes('sk-abcdefghijklmnopqrstuvwx'), serialized);
  check(
    'top-level key secret redacted',
    !serialized.includes('ghp_0123456789abcdefghij0123'),
    serialized,
  );
  check('nested secret redacted', !serialized.includes('xoxp-9876543210-fedcba9876'), serialized);
  check(
    'array-leaf secret redacted',
    !serialized.includes('sk-zyxwvutsrqponmlkjihgfedcba'),
    serialized,
  );
  check(
    'non-secret leaves preserved',
    serialized.includes('plain') && serialized.includes('"note":"fine"'),
    serialized,
  );
  check(
    'REDACTED markers present',
    (serialized.match(/\[REDACTED\]/g) ?? []).length >= 4,
    serialized,
  );

  // A secret used as an object KEY must be masked, and a credential-named field
  // must have its whole value masked even when the value is not token-shaped
  // (plain word, bare hex, or a number).
  const keyAndShapeless = sanitizeMcpActivityValue({
    ghp_keyAsObjectKey0123456789ab: true,
    password: 'correct horse battery staple',
    api_key: '0123456789abcdef0123456789abcdef',
    token: 1234567890123456,
  });
  const ks = JSON.stringify(keyAndShapeless);
  check('secret object KEY redacted', !ks.includes('ghp_keyAsObjectKey0123456789ab'), ks);
  check(
    'credential-named plain-word value masked',
    !ks.includes('correct horse battery staple'),
    ks,
  );
  check(
    'credential-named bare-hex value masked',
    !ks.includes('0123456789abcdef0123456789abcdef'),
    ks,
  );
  check('credential-named numeric value masked', !ks.includes('1234567890123456'), ks);

  // Oversized blob → capped string marker.
  const oversized: Record<string, ActivityPayloadValue> = {
    blob: 'x'.repeat(MAX_MCP_VALUE_CHARS + 5000),
  };
  const cappedRaw = sanitizeMcpActivityValue(oversized);
  check(
    'oversized value collapses to a string',
    typeof cappedRaw === 'string',
    String(typeof cappedRaw),
  );
  const capped = cappedRaw as string;
  check(
    'capped marker present',
    capped.includes('[truncated') && capped.includes('chars]'),
    capped.slice(-60),
  );
  check(
    'capped length ~ MAX + marker (not full blob)',
    capped.length < MAX_MCP_VALUE_CHARS + 64,
    `len=${capped.length}`,
  );

  // Oversized blob ALSO carrying a secret → redact happens before cap.
  const oversizedSecret: Record<string, ActivityPayloadValue> = {
    head: 'sk-abcdefghijklmnopqrstuvwx',
    pad: 'y'.repeat(MAX_MCP_VALUE_CHARS + 2000),
  };
  const cappedSecret = sanitizeMcpActivityValue(oversizedSecret) as string;
  check(
    'secret redacted even when value is later capped',
    !cappedSecret.includes('sk-abcdefghijklmnopqrstuvwx'),
    cappedSecret.slice(0, 80),
  );
}

/* ── AC1: mergeActivityPage cursor / merge / nextCursor ────────────────────── */
console.log('AC1 mergeActivityPage — paging past the wall');

const PAGE_SIZE = 4;

/** Build N descending-time rows for one source. `total` rows exist; a page is
 *  the newest `pageSize` whose `created_at < cursor`. */
function makeSourceRows(
  prefix: string,
  total: number,
): Array<{ record: ActivityRecord; createdAt: string }> {
  const base = Date.parse('2026-06-01T00:00:00.000Z');
  const rows: Array<{ record: ActivityRecord; createdAt: string }> = [];
  for (let i = 0; i < total; i += 1) {
    const at = base + i * 1000; // older → newer as i grows
    const createdAt = new Date(at).toISOString();
    rows.push({
      record: { id: `${prefix}-${i}`, type: `${prefix}.event`, at, actor: prefix },
      createdAt,
    });
  }
  // Newest-first, matching `order by created_at desc`.
  return rows.reverse();
}

/** Emulate one source's paged query: newest `pageSize` rows with createdAt < cursor. */
function pageSource(
  allNewestFirst: Array<{ record: ActivityRecord; createdAt: string }>,
  cursor: string | null,
  pageSize: number,
): ActivitySourcePage {
  const eligible =
    cursor === null ? allNewestFirst : allNewestFirst.filter((r) => r.createdAt < cursor);
  const rows = eligible.slice(0, pageSize);
  return { rows, saturated: rows.length >= pageSize };
}

{
  // One source has 10 rows (> 2 * pageSize); the other two are empty.
  const source = makeSourceRows('runtime', 10);

  // Page 1 (no cursor): newest pageSize rows + a nextCursor.
  const p1 = mergeActivityPage(
    [
      pageSource(source, null, PAGE_SIZE),
      { rows: [], saturated: false },
      { rows: [], saturated: false },
    ],
    PAGE_SIZE,
  );
  check('page1 returns pageSize rows', p1.records.length === PAGE_SIZE, `${p1.records.length}`);
  check(
    'page1 newest-first',
    p1.records[0]?.id === 'runtime-9' && p1.records[3]?.id === 'runtime-6',
    p1.records.map((r) => r.id).join(','),
  );
  check('page1 has a nextCursor', typeof p1.nextCursor === 'string', String(p1.nextCursor));

  // Page 2 (cursor applied): the next-oldest pageSize rows.
  const p2 = mergeActivityPage(
    [
      pageSource(source, p1.nextCursor, PAGE_SIZE),
      { rows: [], saturated: false },
      { rows: [], saturated: false },
    ],
    PAGE_SIZE,
  );
  check(
    'page2 returns the older rows',
    p2.records[0]?.id === 'runtime-5' && p2.records[3]?.id === 'runtime-2',
    p2.records.map((r) => r.id).join(','),
  );
  check(
    'page2 still has a nextCursor (2 rows remain)',
    typeof p2.nextCursor === 'string',
    String(p2.nextCursor),
  );

  // Page 3: the final 2 rows; no source saturated → nextCursor null.
  const p3 = mergeActivityPage(
    [
      pageSource(source, p2.nextCursor, PAGE_SIZE),
      { rows: [], saturated: false },
      { rows: [], saturated: false },
    ],
    PAGE_SIZE,
  );
  check(
    'page3 returns the last 2 rows',
    p3.records.map((r) => r.id).join(',') === 'runtime-1,runtime-0',
    p3.records.map((r) => r.id).join(','),
  );
  check('page3 nextCursor is null (end of history)', p3.nextCursor === null, String(p3.nextCursor));

  // No gaps / no dupes across the three pages — full 10-row history reached.
  const seen = [...p1.records, ...p2.records, ...p3.records].map((r) => r.id);
  check(
    'all 10 rows reached exactly once',
    new Set(seen).size === 10 && seen.length === 10,
    `${seen.length}/${new Set(seen).size}`,
  );

  // Cross-source merge ordering: two saturated sources interleave by time desc.
  const a = makeSourceRows('agent', 6);
  const b = makeSourceRows('mcp', 6);
  const mixed = mergeActivityPage(
    [pageSource(a, null, 3), pageSource(b, null, 3), { rows: [], saturated: false }],
    3,
  );
  const descending = mixed.records.every((r, i, arr) => {
    const prev = arr[i - 1];
    return prev === undefined || prev.at >= r.at;
  });
  check(
    'merged page sorted desc across sources',
    descending,
    mixed.records.map((r) => r.at).join(','),
  );
  check(
    'saturated sources yield a nextCursor',
    typeof mixed.nextCursor === 'string',
    String(mixed.nextCursor),
  );

  // Empty everything → null cursor, no rows.
  const empty = mergeActivityPage(
    [
      { rows: [], saturated: false },
      { rows: [], saturated: false },
      { rows: [], saturated: false },
    ],
    PAGE_SIZE,
  );
  check(
    'empty page → no rows + null cursor',
    empty.records.length === 0 && empty.nextCursor === null,
  );
}

console.log(`\n${h.checks - h.failures}/${h.checks} checks passed`);
if (h.failures > 0) {
  console.error(`\n${h.failures} check(s) FAILED`);
} else {
  console.log('harness-activity-data: PASS');
}
h.report();
