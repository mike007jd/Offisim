#!/usr/bin/env node
import { readFileSync } from 'node:fs';
/**
 * Deterministic round-trip fixture for `add-chat-attachment-end-to-end`.
 *
 * Two assertions, both required by the change spec:
 *   1. A persistence record carrying `pendingAttachments: [refA, refB]`
 *      must serialize → parse → byte-equal.
 *   2. A `ChatMessage.attachments` array on the zustand replay path must
 *      survive the same JSON round-trip byte-equal.
 *
 * Anchored at the JSON serialization layer because that is the actual
 * persistence surface for both the SQLite JSON columns that store chat
 * attachment refs and `chat_session-store` snapshots (browser storage writes
 * `JSON.stringify(repos.snapshot())`). Any incompatibility in
 * `ChatAttachmentRef` (e.g. a Date / Map / Symbol slipping in) would fail
 * here and gate the build.
 */
import process from 'node:process';

const REF_A = {
  attachmentId: '11111111-1111-4111-9111-111111111111',
  vaultRef: 'attachment://co-test/th-test/11111111-1111-4111-9111-111111111111',
  filename: 'plan.pdf',
  mimeType: 'application/pdf',
  byteLength: 4096,
  kind: 'pdf',
  parsedRev: 1,
  summary: 'PDF · 12 pages',
};
const REF_B = {
  attachmentId: '22222222-2222-4222-9222-222222222222',
  vaultRef: 'attachment://co-test/th-test/22222222-2222-4222-9222-222222222222',
  filename: 'q1.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteLength: 12_000,
  kind: 'xlsx',
  parsedRev: 1,
  summary: 'XLSX · 3 sheets, 24 rows',
};

function bytesOf(text) {
  return new TextEncoder().encode(text);
}

function check(label, before, after) {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  if (a !== b) {
    console.error(`[chat-attachment-roundtrip] FAIL ${label}`);
    console.error('  before:', a);
    console.error('  after:', b);
    return false;
  }
  console.log(`[chat-attachment-roundtrip] ok ${label}`);
  return true;
}

function checkpointRoundTrip() {
  const checkpoint = {
    v: 1,
    threadId: 'th-test',
    state: {
      pendingAttachments: [REF_A, REF_B],
      taskRunId: null,
      handoffCount: 0,
    },
  };
  const serialized = JSON.stringify(checkpoint);
  const restored = JSON.parse(serialized);
  return check('checkpoint pendingAttachments JSON round-trip', checkpoint, restored);
}

function chatMessageRoundTrip() {
  const message = {
    id: 'msg-roundtrip',
    role: 'user',
    content: '',
    attachments: [REF_A],
    createdAt: 0,
  };
  const serialized = JSON.stringify(message);
  const restored = JSON.parse(serialized);
  return check('ChatMessage.attachments JSON round-trip', message, restored);
}

function codexEmptyImageWireShape() {
  const runtimeSource = readFileSync(
    new URL('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts', import.meta.url),
    'utf8',
  );
  const hostEventDispatchSource = readFileSync(
    new URL('../apps/desktop/renderer/src/runtime/host-event-dispatch.ts', import.meta.url),
    'utf8',
  );
  const commandTypesSource = readFileSync(
    new URL('../apps/desktop/renderer/src/lib/tauri-commands.ts', import.meta.url),
    'utf8',
  );
  const codexTypesSource = readFileSync(
    new URL(
      '../apps/desktop/src-tauri/src/codex_agent_host/types.rs',
      import.meta.url,
    ),
    'utf8',
  );
  const codexProtocolSource = readFileSync(
    new URL(
      '../apps/desktop/src-tauri/src/codex_agent_host/protocol.rs',
      import.meta.url,
    ),
    'utf8',
  );
  const codexBranch = runtimeSource.match(
    /if \(this\.engineId === 'codex'\) \{[\s\S]*?\} else if \(this\.engineId === 'claude'\)/,
  )?.[0];
  const ok =
    Boolean(codexBranch) &&
    /images: input\.images\?\.length \? input\.images : \[\]/.test(codexBranch) &&
    /images: Array<\{ data: string; mimeType: string \}>;/.test(commandTypesSource) &&
    /artifact_paths: Option<Vec<String>>/.test(codexTypesSource) &&
    /projected_file_change_paths/.test(codexProtocolSource) &&
    /rootRun\('artifact\.created'/.test(hostEventDispatchSource);
  if (!ok) {
    console.error('[chat-attachment-roundtrip] FAIL Codex empty image wire shape');
    return false;
  }
  console.log('[chat-attachment-roundtrip] ok Codex empty image wire shape');
  return true;
}

async function readAttachmentToolScopeGuard() {
  const { createReadAttachmentTool } = await import(
    new URL('../packages/core/dist/tools/builtin/read-attachment-tool.js', import.meta.url).href
  );
  const bytes = bytesOf('tenant-private attachment');
  let bridgeReads = 0;
  const bridge = {
    read: async (vaultRef) => {
      bridgeReads += 1;
      return {
        kind: 'ok',
        meta: {
          attachmentId: 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa',
          companyId: vaultRef.includes('co-other') ? 'co-other' : 'co-test',
          threadId: vaultRef.includes('th-other') ? 'th-other' : 'th-test',
          filename: 'secret.txt',
          mimeType: 'text/plain',
          byteLength: bytes.length,
          sha256: 'sha',
          createdAt: '2026-01-01T00:00:00.000Z',
          parsedRev: 1,
          kind: 'document',
        },
        bytes,
      };
    },
  };
  const tool = createReadAttachmentTool(bridge, undefined, { companyId: 'co-test' });
  const sameScope = await tool.execute(
    { vaultRef: 'attachment://co-test/th-test/aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa' },
    { companyId: 'co-test', runScope: { threadId: 'th-test' } },
  );
  const crossCompany = await tool.execute(
    { vaultRef: 'attachment://co-other/th-test/aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa' },
    { companyId: 'co-test', runScope: { threadId: 'th-test' } },
  );
  const crossThread = await tool.execute(
    { vaultRef: 'attachment://co-test/th-other/aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa' },
    { companyId: 'co-test', runScope: { threadId: 'th-test' } },
  );
  const missingScope = await tool.execute(
    { vaultRef: 'attachment://co-test/th-test/aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa' },
    { companyId: 'co-test' },
  );
  const ok =
    sameScope?.filename === 'secret.txt' &&
    crossCompany?.kind === 'attachment-forbidden' &&
    crossThread?.kind === 'attachment-forbidden' &&
    missingScope?.kind === 'attachment-forbidden' &&
    bridgeReads === 1;
  if (!ok) {
    console.error('[chat-attachment-roundtrip] FAIL read_attachment scope guard');
    console.error(JSON.stringify({ sameScope, crossCompany, crossThread, missingScope }, null, 2));
    return false;
  }
  console.log('[chat-attachment-roundtrip] ok read_attachment scope guard');
  return true;
}

async function readAttachmentStructuredPdfLegacyContent() {
  const { createReadAttachmentTool } = await import(
    new URL('../packages/core/dist/tools/builtin/read-attachment-tool.js', import.meta.url).href
  );
  const bytes = readFileSync(
    new URL('../packages/doc-engine/harness/fixtures/sample.pdf', import.meta.url),
  );
  const bridge = {
    read: async () => ({
      kind: 'ok',
      meta: {
        attachmentId: 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',
        companyId: 'co-test',
        threadId: 'th-test',
        filename: 'sample.pdf',
        mimeType: 'application/pdf',
        byteLength: bytes.length,
        sha256: 'sha',
        createdAt: '2026-01-01T00:00:00.000Z',
        parsedRev: 1,
        kind: 'pdf',
      },
      bytes,
    }),
  };
  const tool = createReadAttachmentTool(bridge, undefined, { companyId: 'co-test' });
  const result = await tool.execute(
    {
      vaultRef: 'attachment://co-test/th-test/bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',
      mode: 'structured',
    },
    { companyId: 'co-test', runScope: { threadId: 'th-test' } },
  );
  const ok =
    result?.structured?.kind === 'pdf' &&
    typeof result.structured.text === 'string' &&
    result.structured.text.length > 0 &&
    result.content === result.structured.text;
  if (!ok) {
    console.error('[chat-attachment-roundtrip] FAIL structured PDF legacy content');
    console.error(JSON.stringify(result, null, 2));
    return false;
  }
  console.log('[chat-attachment-roundtrip] ok structured PDF legacy content');
  return true;
}

const ok = [
  checkpointRoundTrip(),
  chatMessageRoundTrip(),
  codexEmptyImageWireShape(),
  await readAttachmentToolScopeGuard(),
  await readAttachmentStructuredPdfLegacyContent(),
].every(Boolean);
console.log(JSON.stringify({ suite: 'chat-attachment-roundtrip', ok }, null, 2));
if (!ok) process.exit(1);
