#!/usr/bin/env node
// Round-trip verification for deliverable contributor brand fields.
//
// Validates the close-frontend-ux-debt propagation contract:
//   1. mixed internal/external contributors stringify to contributors_json
//   2. safeParseContributors deserializes back with isExternal + brandKey intact
//   3. legacy JSON missing the brand fields normalizes to internal fallback

import assert from 'node:assert/strict';

const fixtureMixed = [
  {
    employeeId: 'emp-a',
    employeeName: 'Maya',
    sourceKind: 'employee',
    roleSlug: 'designer',
    isExternal: false,
    brandKey: null,
  },
  {
    employeeId: 'emp-b',
    employeeName: 'Hermes Bot',
    sourceKind: 'employee',
    roleSlug: 'external',
    isExternal: true,
    brandKey: 'hermes',
  },
  {
    employeeId: 'emp-c',
    employeeName: 'Generic Bot',
    sourceKind: 'employee',
    roleSlug: 'external',
    isExternal: true,
    brandKey: null,
  },
];

const legacyJson = JSON.stringify([
  {
    employeeId: 'emp-legacy',
    employeeName: 'Old Maya',
    sourceKind: 'employee',
    roleSlug: 'designer',
  },
]);

// Simulate persistence-service stringify path.
const stringified = JSON.stringify(fixtureMixed);

// Mirror of safeParseContributors in packages/ui-office/src/lib/deliverable-artifacts.ts.
// Keep this in sync if the production normalizer changes.
function safeParseContributors(json) {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => {
      const hasExternal = typeof c.isExternal === 'boolean';
      const hasBrand = typeof c.brandKey === 'string' || c.brandKey === null;
      if (hasExternal && hasBrand) return c;
      return {
        employeeId: c.employeeId ?? '',
        employeeName: c.employeeName ?? '',
        sourceKind: c.sourceKind,
        roleSlug: typeof c.roleSlug === 'string' ? c.roleSlug : '',
        isExternal: hasExternal ? c.isExternal : false,
        brandKey: hasBrand ? c.brandKey : null,
      };
    });
  } catch {
    return [];
  }
}

const roundtripped = safeParseContributors(stringified);

assert.equal(roundtripped.length, 3, 'expected 3 contributors after round-trip');
assert.deepEqual(roundtripped[0].isExternal, false, 'internal contributor preserves false');
assert.deepEqual(roundtripped[0].brandKey, null, 'internal contributor preserves null brandKey');
assert.deepEqual(roundtripped[1].isExternal, true, 'external Hermes preserves true');
assert.deepEqual(roundtripped[1].brandKey, 'hermes', 'external Hermes preserves brandKey');
assert.deepEqual(roundtripped[2].isExternal, true, 'external generic preserves true');
assert.deepEqual(roundtripped[2].brandKey, null, 'external generic preserves null brandKey');

const legacy = safeParseContributors(legacyJson);
assert.equal(legacy.length, 1, 'legacy JSON parses to 1 contributor');
assert.equal(legacy[0].isExternal, false, 'legacy contributor backfilled to internal');
assert.equal(legacy[0].brandKey, null, 'legacy contributor backfilled to null brandKey');

console.log('[verify-deliverable-contributor-roundtrip] OK');
console.log(JSON.stringify({ mixed: roundtripped.length, legacy: legacy.length }, null, 2));
