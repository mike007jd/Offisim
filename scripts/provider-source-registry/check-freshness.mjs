#!/usr/bin/env node
/**
 * Provider catalog freshness gate.
 *
 * Reads `catalog/provider-source-registry/official-fixtures.json` (the
 * hand-verified, official-tier source of truth for provider defaults + leaf
 * model ids) and fails when the fixture is malformed or the catalog would ship
 * a stale recommendation:
 *
 *   ERROR (exit 1):
 *     - the fixture fails shape validation (a typo'd/missing required field, an
 *       invalid model `status`, a malformed date) — see `normalizeFixturesShape`
 *     - a provider's `defaultModel` is missing from its `models` map
 *     - a provider's `defaultModel` is marked `status: "retired"`
 *     - a provider's `defaultModel` has a `retiresOn` date that is today or past
 *
 *   WARN (exit 0, still printed):
 *     - a `defaultModel` points at a `status: "legacy"` model
 *     - any model's `retiresOn` is within `--warn-within-days` (default 30)
 *     - a non-default model is past its `retiresOn` (tombstone — consider removing)
 *     - a provider with models is missing `lastVerifiedAt` / `sourceUrl`
 *     - a `vendor` has no drift mapping in `VENDOR_OPENROUTER_FAMILY`
 *     - `verification.checkedAt` is older than `verification.staleAfterDays`
 *     - the cached default-drift snapshot is itself older than `staleAfterDays`
 *
 * This is intentionally offline + deterministic: it only reads the local
 * fixture, so it is safe to run in `validate` / pre-commit without network.
 * Re-verifying the actual model ids against each provider's live docs is a
 * human step — this gate just makes "the catalog is overdue / about to break"
 * loud instead of silent.
 *
 * Usage:
 *   node scripts/provider-source-registry/check-freshness.mjs
 *   node scripts/provider-source-registry/check-freshness.mjs --today 2026-06-20
 *   node scripts/provider-source-registry/check-freshness.mjs --warn-within-days 45
 */
import { resolve } from 'node:path';
import { CATALOG_DIR, asUtcDate, normalizeFixturesShape, readJson } from './lib/catalog.mjs';
import { parseArgs } from './lib/cli-args.mjs';
import { VENDOR_OPENROUTER_FAMILY } from './lib/latest-models.mjs';

function daysBetween(fromMs, toMs) {
  return Math.floor((toMs - fromMs) / 86_400_000);
}

const args = parseArgs(process.argv.slice(2));
const warnWithinDays = Number.parseInt(args['warn-within-days'] ?? '30', 10);
const todayArg = args.today;
// Default baseline is the real run-time date — a freshness gate must use the
// real clock, not a frozen constant. `--today` only exists for deterministic
// testing of the gate itself.
const nowMs = todayArg ? asUtcDate(todayArg) : Date.now();
if (nowMs == null) {
  console.error(`Invalid --today "${todayArg}" (expected YYYY-MM-DD).`);
  process.exit(2);
}
const todayIso = new Date(nowMs).toISOString().slice(0, 10);

const errors = [];
const warnings = [];

const fixturesPath = resolve(CATALOG_DIR, 'official-fixtures.json');
const fixtures = await readJson(fixturesPath);

// Foundation integrity: validate the fixture's structure before reading any
// freshness field, so a typo (`status: "currnet"`, `retiredOn`, a string
// `staleAfterDays`) is a hard failure instead of being silently read past. A
// freshness gate whose own data layer can be hollowed out by a typo is no gate.
const shapeErrors = normalizeFixturesShape(fixtures);
if (shapeErrors.length > 0) {
  console.error(`official-fixtures.json failed shape validation (${shapeErrors.length} error(s)):`);
  for (const shapeError of shapeErrors) console.error(`  ✖ ${shapeError}`);
  console.error('\nprovider:check failed — fix the malformed fixture fields above.');
  process.exit(1);
}

// Shape validation guarantees a well-formed verification baseline below.
const verification = fixtures.verification;
const staleAfterDays = verification.staleAfterDays;
const checkedMs = asUtcDate(verification.checkedAt);
const verifiedAge = daysBetween(checkedMs, nowMs);
if (verifiedAge > staleAfterDays) {
  warnings.push(
    `catalog last verified ${verification.checkedAt} (${verifiedAge}d ago, > staleAfterDays ${staleAfterDays}); re-verify provider defaults against live docs and run \`pnpm provider:refresh\`.`,
  );
}

// A vendor with no drift mapping silently disables behind-detection for it
// (looks like a deliberate `skip`). Make the omission loud, not silent rot.
const fixtureVendors = new Set(
  Object.values(fixtures.providers).map((provider) => provider.vendor),
);
for (const vendor of [...fixtureVendors].sort()) {
  if (!(vendor in VENDOR_OPENROUTER_FAMILY)) {
    warnings.push(
      `vendor "${vendor}" has no drift mapping in latest-models.mjs (VENDOR_OPENROUTER_FAMILY); behind-detection is silently off for it — add a {namespace,line} or an explicit {skip}.`,
    );
  }
}

const providers = fixtures.providers ?? {};
for (const providerId of Object.keys(providers).sort()) {
  const provider = providers[providerId];
  if (!provider || typeof provider !== 'object') continue;
  const models = provider.models ?? {};
  const modelIds = Object.keys(models);
  if (modelIds.length === 0) continue; // e.g. the user-defined `custom` passthrough

  if (!provider.lastVerifiedAt) {
    warnings.push(`${providerId}: missing lastVerifiedAt.`);
  }
  if (!provider.sourceUrl) {
    warnings.push(`${providerId}: missing sourceUrl.`);
  }

  for (const modelId of modelIds) {
    const model = models[modelId] ?? {};
    const retiresMs = asUtcDate(model.retiresOn);
    if (retiresMs != null && retiresMs <= nowMs && modelId !== provider.defaultModel) {
      warnings.push(
        `${providerId} / ${modelId}: past retiresOn ${model.retiresOn} — tombstone, consider removing.`,
      );
    } else if (retiresMs != null && retiresMs > nowMs) {
      const daysLeft = daysBetween(nowMs, retiresMs);
      if (daysLeft <= warnWithinDays) {
        warnings.push(`${providerId} / ${modelId}: retires in ${daysLeft}d (${model.retiresOn}).`);
      }
    }
  }

  const defaultModel = provider.defaultModel;
  if (!defaultModel) continue; // provider exposes models but no single default — allowed
  const defModel = models[defaultModel];
  if (!defModel) {
    errors.push(`${providerId}: defaultModel "${defaultModel}" is not in its models map.`);
    continue;
  }
  if (defModel.status === 'retired') {
    errors.push(
      `${providerId}: defaultModel "${defaultModel}" is marked retired — pick a current model.`,
    );
  } else if (defModel.status === 'legacy') {
    warnings.push(
      `${providerId}: defaultModel "${defaultModel}" is marked legacy — prefer a current model.`,
    );
  }
  const defRetiresMs = asUtcDate(defModel.retiresOn);
  if (defRetiresMs != null && defRetiresMs <= nowMs) {
    errors.push(
      `${providerId}: defaultModel "${defaultModel}" is at/past retiresOn ${defModel.retiresOn}.`,
    );
  }
}

// Surface the last `provider:refresh` default-drift (computed against the live
// OpenRouter list) without re-fetching — keeps this gate offline/deterministic.
try {
  const driftReport = await readJson(resolve(CATALOG_DIR, 'generated', 'diff-report.json'));
  const drift = driftReport.defaultDrift;
  if (drift && Array.isArray(drift.providers)) {
    const driftDateIso =
      typeof driftReport.generatedAt === 'string' ? driftReport.generatedAt.slice(0, 10) : null;
    const driftMs = asUtcDate(driftDateIso);
    const driftAge = driftMs == null ? null : daysBetween(driftMs, nowMs);
    // TTL on the cached drift snapshot: past staleAfterDays, the per-provider
    // "behind" lines are stale conclusions that read as fresh at a glance.
    // Replace them with one "refresh me" line rather than parroting old drift.
    if (driftAge != null && driftAge > staleAfterDays) {
      warnings.push(
        `default-drift snapshot is ${driftAge}d old (generated ${driftDateIso}, > staleAfterDays ${staleAfterDays}) — run \`pnpm provider:refresh\` to recompute it; not reporting per-provider drift from a stale snapshot.`,
      );
    } else {
      for (const entry of drift.providers) {
        if (entry.status === 'behind') {
          warnings.push(
            `${entry.providerId}: default "${entry.defaultModel}" is behind — OpenRouter has "${entry.latestLeafId}" (${entry.latestCreated}) as of last refresh ${driftDateIso ?? '?'}; run \`pnpm provider:latest\` to re-check, then bump it.`,
          );
        }
      }
    }
  }
} catch {
  // diff-report not generated yet — `pnpm provider:refresh` / `provider:latest`
  // populate it; absence is not an error for the offline gate.
}

const providerCount = Object.keys(providers).length;
console.log(
  `provider catalog freshness check — baseline ${todayIso} · ${providerCount} providers · ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`,
);
for (const warning of warnings) console.log(`  ⚠︎ ${warning}`);
for (const error of errors) console.error(`  ✖ ${error}`);

if (errors.length > 0) {
  console.error(
    '\nprovider:check failed — a default model is retired/dangling or past its retirement date.',
  );
  process.exit(1);
}
console.log(warnings.length > 0 ? '\nok (with warnings)' : '\nok');
