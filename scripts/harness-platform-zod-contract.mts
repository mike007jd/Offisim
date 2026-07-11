#!/usr/bin/env node

import { errorHandler } from '../apps/platform/src/middleware/error-handler.js';
import {
  DraftCreateSchema,
  InstallReceiptSchema,
  ListingStatusPatchSchema,
  ManifestUploadSchema,
  ReportCreateSchema,
} from '../apps/platform/src/schemas/index.js';

type FakeResponse = {
  body: unknown;
  status: number;
};

type ValidationError = Error & {
  issues: Array<{ message: string; path: PropertyKey[] }>;
};

type ValidationSchema = {
  safeParse: (input: unknown) =>
    | { success: true }
    | {
        error: ValidationError;
        success: false;
      };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validationError(schema: ValidationSchema, input: unknown): ValidationError {
  const result = schema.safeParse(input);
  assert(!result.success, 'fixture must fail validation');
  return result.error;
}

function assertFirstMessage(schema: ValidationSchema, input: unknown, expected: string): void {
  const error = validationError(schema, input);
  assert(
    error.issues[0]?.message === expected,
    `expected "${expected}", got "${error.issues[0]?.message}"`,
  );
}

assertFirstMessage(
  DraftCreateSchema,
  { kind: 'not-a-kind', title: 'Fixture' },
  'Invalid draft kind: not-a-kind',
);
assertFirstMessage(
  InstallReceiptSchema,
  {
    install_source: 'not-a-source',
    listing_id: '00000000-0000-0000-0000-000000000000',
    package_version_id: '00000000-0000-0000-0000-000000000001',
  },
  'install_source must be registry, url, or file',
);
assertFirstMessage(
  ReportCreateSchema,
  { reason: 'not-a-reason' },
  'reason must be one of: spam, malicious_code, copyright, misleading, other',
);
assertFirstMessage(
  ListingStatusPatchSchema,
  { status: 'not-a-status' },
  'status must be one of: listed, hidden, retired',
);

const manifest = ManifestUploadSchema.parse({
  manifest_json: {
    'arbitrary-key': { nested: true },
    version: 1,
  },
});
assert(
  (manifest.manifest_json['arbitrary-key'] as { nested?: boolean }).nested === true,
  'manifest_json must preserve arbitrary string keys',
);

const routeError = validationError(DraftCreateSchema, {
  kind: 'not-a-kind',
  title: 'Fixture',
});
const response = errorHandler(routeError, {
  get: () => 'zod-contract-fixture',
  json: (body: unknown, status: number) => ({ body, status }),
} as never) as unknown as FakeResponse;

assert(response.status === 400, 'Zod errors must return HTTP 400');
assert(
  JSON.stringify(response.body) ===
    JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ path: 'kind', message: 'Invalid draft kind: not-a-kind' }],
      },
    }),
  'Zod error response wire shape drifted',
);

console.log('PASS harness:platform-zod-contract');
