/**
 * Computer rich-detail contract gate.
 *
 * Locks the neutral ToolRichDetail shape used by Computer Use MCP tools before
 * the Stage computer tab exists. This stays pure shared-types logic: no Cua
 * Driver, no Pi SDK, no renderer.
 */
import assert from 'node:assert/strict';
import { mergeToolRichDetail, parseToolRichDetail } from '../packages/shared-types/src/index.js';

let passed = 0;
let failed = 0;
const TOTAL = 8;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

console.log('harness:computer-rich-detail — computer tool detail parsing\n');

await check('computer:detail-json-maps-family', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ computer: { action: 'observe', targetApp: 'TextEdit' } }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.equal(detail.targetApp, 'TextEdit');
});

await check('computer:action-kind-parsed', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ computer: { action: 'click', targetWindow: 'Untitled', resultState: 'ok' } }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.equal(detail.action, 'click');
  assert.equal(detail.targetWindow, 'Untitled');
  assert.equal(detail.resultState, 'ok');
});

await check('computer:screenshot-dataref-preserved', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({
      computer: { action: 'screenshot', targetApp: 'Safari' },
      image: { mimeType: 'image/png', dataRef: 'data:image/png;base64,aaa' },
    }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.deepEqual(detail.screenshot, {
    mimeType: 'image/png',
    dataRef: 'data:image/png;base64,aaa',
  });
});

await check('computer:merge-keeps-last-screenshot', () => {
  const withShot = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({
      computer: { action: 'screenshot', targetApp: 'Safari' },
      image: { mimeType: 'image/png', dataRef: 'data:image/png;base64,old' },
    }),
  );
  const laterNoShot = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ computer: { action: 'click', coordinates: { x: 12, y: 34 } } }),
  );
  const merged = mergeToolRichDetail(withShot, laterNoShot);
  assert.equal(merged.family, 'computer');
  if (merged.family !== 'computer') return;
  assert.equal(merged.action, 'click');
  assert.deepEqual(merged.coordinates, { x: 12, y: 34 });
  assert.deepEqual(merged.screenshot, {
    mimeType: 'image/png',
    dataRef: 'data:image/png;base64,old',
  });
});

await check('computer:text-preview-caps-length', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ computer: { textPreview: 'x'.repeat(500) } }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.equal(detail.textPreview?.length, 160);
});

await check('computer:text-preview-redacts-credentials', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({
      computer: {
        action: 'type',
        textPreview: 'login with password: hunter2 then paste sk-abc123def456ghi789',
      },
    }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.ok(detail.textPreview);
  assert.ok(!detail.textPreview.includes('hunter2'), 'password value must be masked');
  assert.ok(!detail.textPreview.includes('sk-abc123def456ghi789'), 'token must be masked');
  assert.ok(detail.textPreview.includes('login with'), 'benign text must survive');
});

await check('computer:no-marker-falls-through-to-browser-then-generic', () => {
  const browser = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({
      content: [
        { type: 'text', text: 'Title: Example\nhttps://example.com' },
        { type: 'image', mimeType: 'image/png', data: 'aaa' },
      ],
    }),
  );
  assert.equal(browser.family, 'browser');
  const generic = parseToolRichDetail('mcp_call', JSON.stringify({ content: [{ type: 'text', text: 'plain' }] }));
  assert.equal(generic.family, 'generic');
});

await check('computer:coordinates-parsed', () => {
  const detail = parseToolRichDetail(
    'mcp_call',
    JSON.stringify({ computer: { coordinates: { x: 42, y: 7 } } }),
  );
  assert.equal(detail.family, 'computer');
  if (detail.family !== 'computer') return;
  assert.deepEqual(detail.coordinates, { x: 42, y: 7 });
});

console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
if (failed > 0 || passed !== TOTAL) process.exit(1);
