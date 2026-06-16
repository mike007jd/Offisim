import {
  WEB_FETCH_MAX_BODY_BYTES,
  readWebFetchTextWithLimit,
  validateWebFetchUrl,
} from '../packages/core/src/tools/builtin/web-fetch-tool.js';

const deniedUrls = [
  'file:///etc/passwd',
  'http://localhost:4100/admin',
  'http://127.0.0.1:4100/admin',
  'http://0.0.0.0:4100/admin',
  'http://10.0.0.5/private',
  'http://172.16.0.1/private',
  'http://192.168.1.10/private',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1]/private',
  'http://metadata.google.internal/computeMetadata/v1',
];

for (const url of deniedUrls) {
  try {
    validateWebFetchUrl(url);
  } catch {
    continue;
  }
  throw new Error(`web_fetch accepted denied URL: ${url}`);
}

const allowed = validateWebFetchUrl('https://example.com/docs');
if (allowed.hostname !== 'example.com') {
  throw new Error('web_fetch rejected a normal https URL');
}

try {
  await readWebFetchTextWithLimit(
    new Response('x'.repeat(WEB_FETCH_MAX_BODY_BYTES + 1), {
      headers: { 'content-length': String(WEB_FETCH_MAX_BODY_BYTES + 1) },
    }),
  );
} catch {
  console.log('Web fetch security harness passed.');
  process.exit(0);
}

throw new Error('web_fetch accepted an oversized response body');
