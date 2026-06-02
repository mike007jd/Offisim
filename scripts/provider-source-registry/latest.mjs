#!/usr/bin/env node
/**
 * `provider:latest` — live, keyless "are our pinned default models behind?".
 *
 * Fetches the OpenRouter model list (no API key) and compares each
 * official-fixtures `defaultModel` to the newest leaf id in its family by
 * `created` date. Prints a drift report. Exits 0 (informational) — the hard
 * gate is `provider:check`; this is the quick live look + what a scheduled
 * refresh runs to keep the catalog honest without anyone chasing release notes.
 *
 *   node scripts/provider-source-registry/latest.mjs
 *   node scripts/provider-source-registry/latest.mjs --json
 */
import { resolve } from 'node:path';
import { CATALOG_DIR, readJson } from './lib/catalog.mjs';
import { detectDefaultDrift, fetchOpenRouterModels } from './lib/latest-models.mjs';

const asJson = process.argv.includes('--json');

const officialFixtures = await readJson(resolve(CATALOG_DIR, 'official-fixtures.json'));

let openRouterData;
try {
  openRouterData = await fetchOpenRouterModels();
} catch (error) {
  console.error(`provider:latest — could not reach OpenRouter: ${error.message}`);
  process.exit(asJson ? 1 : 0);
}

const drift = detectDefaultDrift({ openRouterData, officialFixtures });

if (asJson) {
  console.log(JSON.stringify(drift, null, 2));
  process.exit(0);
}

console.log(
  `provider:latest — ${drift.summary.providerCount} providers · ` +
    `${drift.summary.behind} behind · ${drift.summary.current} current · ` +
    `${drift.summary.unverifiable} unverifiable · ${drift.summary.manual} manual\n`,
);
for (const p of drift.providers) {
  if (p.status === 'behind') {
    console.log(
      `  ⤴ ${p.providerId}: pinned "${p.defaultModel}" (${p.pinnedCreated}) — newer available: ` +
        `${p.latestLeafId} (${p.latestCreated})`,
    );
  } else if (p.status === 'current') {
    console.log(`  ✓ ${p.providerId}: "${p.defaultModel}" is newest in family`);
  } else if (p.status === 'unverifiable') {
    console.log(
      `  ? ${p.providerId}: "${p.defaultModel}" not on OpenRouter — newest seen: ${p.latestLeafId}`,
    );
  } else {
    console.log(`  · ${p.providerId}: "${p.defaultModel}" (${p.status}: ${p.reason})`);
  }
}
if (drift.summary.behind > 0) {
  console.log(
    "\nSome defaults are behind. Re-verify the newer leaf id against the provider's official docs, " +
      'then update catalog/provider-source-registry/official-fixtures.json (keep the old one as status:legacy).',
  );
}
