#!/usr/bin/env node
/**
 * Build-time generator: compiles the manifest JSON schema into a standalone
 * JS validator so the browser runtime never needs `ajv.compile()` (which
 * internally calls `new Function` — blocked by Tauri's CSP `script-src 'self'`
 * without `unsafe-eval`).
 *
 * Output (gitignored, regenerated every build):
 *   - src/schema/manifest-validator.generated.js   — pure JS function module
 *   - src/schema/manifest-validator.generated.d.ts — typed default export
 *
 * TypeScript resolves the `.js` import in `validate.ts` via the sibling
 * `.d.ts`. Post-tsc, a small copy step moves the two generated files into
 * `dist/schema/` so the published package is self-contained.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const schemaPath = path.resolve(pkgRoot, 'src/schema/manifest-1.0.0.json');
const outJs = path.resolve(pkgRoot, 'src/schema/manifest-validator.generated.js');
const outDts = path.resolve(pkgRoot, 'src/schema/manifest-validator.generated.d.ts');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv2020({
  code: { source: true, esm: true, optimize: true },
  allErrors: true,
  strict: false,
  validateFormats: false,
});

const validate = ajv.compile(schema);
let code = standaloneCode(ajv, validate);

// Ajv's standalone output still emits `require("ajv/dist/runtime/ucs2length")`
// for `maxLength` / `minLength` validation (it counts code points, not UTF-16
// code units). That single `require` pulls the whole Ajv package into any
// downstream bundle — the CSP-breaking `new Function` in Ajv's `compile()`
// rides along. Inline the tiny helper and rewrite the require site so the
// generated module is fully self-contained (no `require`, no `new Function`).
const UCS2_HELPER_NAME = '__offisimUcs2length';
const UCS2_HELPER_SOURCE = `function ${UCS2_HELPER_NAME}(s){let l=0,i=0;while(i<s.length){l++;const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff)i++;i++;}return l;}`;
const ucs2RequirePattern = /require\("ajv\/dist\/runtime\/ucs2length"\)\.default/g;
if (ucs2RequirePattern.test(code)) {
  code = code.replace(ucs2RequirePattern, UCS2_HELPER_NAME);
  const prefix = '"use strict";';
  if (code.startsWith(prefix)) {
    code = `${prefix}${UCS2_HELPER_SOURCE}${code.slice(prefix.length)}`;
  } else {
    code = `${UCS2_HELPER_SOURCE}${code}`;
  }
}

// Abort if any `require(...)` survived — surface as a build error so we don't
// silently leak an Ajv-dependent require into the browser bundle.
const strayRequire = code.match(/require\(["'][^"']+["']\)/);
if (strayRequire) {
  throw new Error(
    `[asset-schema] generated validator still contains require(): ${strayRequire[0]}. ` +
      `Inline the helper in generate-validator.mjs before the bundle pulls Ajv in.`,
  );
}

fs.writeFileSync(outJs, code);

const dts = `import type { ErrorObject } from 'ajv';

declare const validate: ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

export default validate;
`;
fs.writeFileSync(outDts, dts);

console.log(`[asset-schema] generated validator: ${path.relative(pkgRoot, outJs)}`);
