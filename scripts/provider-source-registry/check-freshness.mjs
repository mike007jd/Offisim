#!/usr/bin/env node
/**
 * Provider catalog freshness gate.
 *
 * Reads `catalog/provider-source-registry/official-fixtures.json` (the
 * hand-verified, official-tier source of truth for provider defaults + leaf
 * model ids) and fails when the catalog would ship a stale recommendation:
 *
 *   ERROR (exit 1):
 *     - a provider's `defaultModel` is missing from its `models` map
 *     - a provider's `defaultModel` is marked `status: "retired"`
 *     - a provider's `defaultModel` has a `retiresOn` date that is today or past
 *
 *   WARN (exit 0, still printed):
 *     - a `defaultModel` points at a `status: "legacy"` model
 *     - any model's `retiresOn` is within `--warn-within-days` (default 30)
 *     - a non-default model is past its `retiresOn` (tombstone — consider removing)
 *     - a provider with models is missing `lastVerifiedAt` / `sourceUrl`
 *     - a model with no `status`
 *     - `verification.checkedAt` is older than `verification.staleAfterDays`
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
import { CATALOG_DIR, readJson } from './lib/catalog.mjs';
import { parseArgs } from './lib/cli-args.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function asUtcDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value.trim())) return null;
  const ms = Date.parse(`${value.trim()}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

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

const verification = fixtures.verification ?? null;
if (!verification || typeof verification.checkedAt !== 'string') {
  warnings.push('verification.checkedAt is missing — catalog has no freshness baseline.');
} else {
  const checkedMs = asUtcDate(verification.checkedAt);
  const staleAfterDays = Number.isFinite(verification.staleAfterDays)
    ? verification.staleAfterDays
    : 90;
  if (checkedMs == null) {
    warnings.push(`verification.checkedAt "${verification.checkedAt}" is not a YYYY-MM-DD date.`);
  } else {
    const age = daysBetween(checkedMs, nowMs);
    if (age > staleAfterDays) {
      warnings.push(
        `catalog last verified ${verification.checkedAt} (${age}d ago, > staleAfterDays ${staleAfterDays}); re-verify provider defaults against live docs and run \`pnpm provider:refresh\`.`,
      );
    }
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
    const status = typeof model.status === 'string' ? model.status : null;
    if (!status) {
      warnings.push(`${providerId} / ${modelId}: no status (expected current|legacy|retired).`);
    }
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
    const driftGeneratedAt =
      typeof driftReport.generatedAt === 'string' ? driftReport.generatedAt.slice(0, 10) : '?';
    for (const entry of drift.providers) {
      if (entry.status === 'behind') {
        warnings.push(
          `${entry.providerId}: default "${entry.defaultModel}" is behind — OpenRouter has "${entry.latestLeafId}" (${entry.latestCreated}) as of last refresh ${driftGeneratedAt}; run \`pnpm provider:latest\` to re-check, then bump it.`,
        );
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
