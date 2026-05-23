import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(
  new URL('../packages/ui-office/src/components/chat/tauri-dropped-files.ts', import.meta.url),
  'utf8',
);

assert.match(source, /CHAT_ATTACHMENT_MAX_BYTES/u);

const sizeCheckIndex = source.indexOf('info.size > CHAT_ATTACHMENT_MAX_BYTES');
const readIndex = source.indexOf('const bytes = await fs.readFile(path)');

assert.ok(sizeCheckIndex > 0, 'dropped-file reader must reject oversize files after stat');
assert.ok(readIndex > 0, 'dropped-file reader must still read allowed files');
assert.ok(
  sizeCheckIndex < readIndex,
  'dropped-file reader must enforce the 8 MB cap before fs.readFile',
);

console.log('Chat attachment security harness passed.');
