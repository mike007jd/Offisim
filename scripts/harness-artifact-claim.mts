/**
 * Deterministic artifact-claim resolver gate (INC-1).
 *
 * Locks the pure projection in
 * `apps/desktop/renderer/src/surfaces/office/stage-viewer/artifact-claim.ts`:
 * every visual claim resolves to the unified preview stage target under a fixed
 * source priority (deliverableId > url/browser-detail > path > logs), and the
 * key fields survive the projection. Logs remain the generic non-visual
 * fallback.
 *
 * Pure Node via tsx against renderer source (renderer tsconfig paths) — no DOM,
 * no Tauri, no Pi. Only `resolveArtifactClaim` (pure) is exercised.
 */
import type { ClaimableArtifact } from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
import { resolveArtifactClaim } from '../apps/desktop/renderer/src/surfaces/office/stage-viewer/artifact-claim.js';

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('artifact-claim gate');

// ── deliverableId-only → preview/deliverable ────────────────────────────────
console.log('\n[preview] a deliverable id resolves to a deliverable preview source');
{
  const claim: ClaimableArtifact = {
    title: 'qa-report.md',
    kind: 'report',
    deliverableId: 'del-1',
    threadId: 'th-9',
  };
  const r = resolveArtifactClaim(claim);
  check('kind is preview (not logs)', r.kind === 'preview', `got ${r.kind}`);
  check(
    'preview ref carries deliverableId + threadId + title',
    r.kind === 'preview' &&
      r.ref.source === 'deliverable' &&
      r.ref.deliverableId === 'del-1' &&
      r.ref.threadId === 'th-9' &&
      r.title === 'qa-report.md',
  );
}

// ── deliverableId with no threadId → threadId null ──────────────────────────
console.log('\n[preview] missing threadId defaults to null');
{
  const r = resolveArtifactClaim({ title: 't', kind: 'k', deliverableId: 'del-2' });
  check(
    'deliverable preview threadId defaults to null when absent',
    r.kind === 'preview' && r.ref.source === 'deliverable' && r.ref.threadId === null,
    r.kind === 'preview' && r.ref.source === 'deliverable' ? String(r.ref.threadId) : r.kind,
  );
}

// ── url-only → preview ──────────────────────────────────────────────────────
console.log('\n[preview] a url resolves to the preview surface');
{
  const r = resolveArtifactClaim({
    title: 'Landing',
    kind: 'page',
    url: 'https://example.test/',
    sourceId: 'src-1',
  });
  check('kind is preview (not logs)', r.kind === 'preview', `got ${r.kind}`);
  check(
    'preview carries url + sourceId + title',
    r.kind === 'preview' &&
      r.ref.source === 'browser' &&
      r.ref.url === 'https://example.test/' &&
      r.ref.sourceId === 'src-1' &&
      r.title === 'Landing',
  );
  check(
    'url-only preview has no browser detail',
    r.kind === 'preview' && r.ref.source === 'browser' && r.ref.detail === undefined,
  );
}

// ── browser-detail → preview (detail included only when family is browser) ──
console.log('\n[preview] a browser rich detail resolves to preview + detail');
{
  const r = resolveArtifactClaim({
    title: 'Site',
    kind: 'browser',
    detail: { family: 'browser', url: 'https://d.test/', title: 'Site' },
  });
  check('kind is preview from browser detail', r.kind === 'preview', `got ${r.kind}`);
  check(
    'preview includes the browser detail',
    r.kind === 'preview' &&
      r.ref.source === 'browser' &&
      r.ref.detail?.family === 'browser' &&
      r.ref.detail.url === 'https://d.test/',
  );
}

// ── a non-browser detail alone does not force preview ───────────────────────
console.log('\n[logs] a non-browser detail with no url/path/deliverable → logs');
{
  const r = resolveArtifactClaim({
    title: 'ran tests',
    kind: 'terminal',
    detail: { family: 'terminal', command: 'pnpm test', exitCode: 0 },
  });
  check(
    'non-browser detail alone resolves to logs (not preview)',
    r.kind === 'logs',
    `got ${r.kind}`,
  );
  check(
    'logs carries the original detail through',
    r.kind === 'logs' && r.detail?.family === 'terminal',
  );
}

// ── path-only → preview/workspace-file ──────────────────────────────────────
console.log('\n[preview] a filesystem path resolves to a workspace-file source');
{
  const r = resolveArtifactClaim({ title: 'main.rs', kind: 'file', path: '/repo/src/main.rs' });
  check('kind is preview (not logs)', r.kind === 'preview', `got ${r.kind}`);
  check(
    'preview ref carries path + title',
    r.kind === 'preview' &&
      r.ref.source === 'workspace-file' &&
      r.ref.path === '/repo/src/main.rs' &&
      r.title === 'main.rs',
  );
}

// ── bare title → logs (generic fallback) ────────────────────────────────────
console.log('\n[logs] a bare claim falls back to the logs surface');
{
  const r = resolveArtifactClaim({ title: 'did a thing', kind: 'generic', sourceId: 'src-z' });
  check('kind is logs fallback', r.kind === 'logs', `got ${r.kind}`);
  check(
    'logs carries title + sourceId',
    r.kind === 'logs' && r.title === 'did a thing' && r.sourceId === 'src-z',
  );
}

// ── priority: deliverableId beats path ──────────────────────────────────────
console.log('\n[priority] deliverableId outranks path');
{
  const r = resolveArtifactClaim({
    title: 'both',
    kind: 'report',
    deliverableId: 'del-3',
    path: '/repo/out.md',
  });
  check(
    'deliverableId + path → deliverable preview (not workspace-file)',
    r.kind === 'preview' && r.ref.source === 'deliverable' && r.ref.deliverableId === 'del-3',
    `got ${r.kind}`,
  );
}

// ── priority: url beats path ────────────────────────────────────────────────
console.log('\n[priority] url outranks path');
{
  const r = resolveArtifactClaim({
    title: 'both',
    kind: 'page',
    url: 'https://p.test/',
    path: '/repo/out.html',
  });
  check(
    'url + path → browser preview (not workspace-file)',
    r.kind === 'preview' && r.ref.source === 'browser' && r.ref.url === 'https://p.test/',
    `got ${r.kind}`,
  );
}

console.log(`\nartifact-claim: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`artifact-claim gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('artifact-claim gate PASSED');
