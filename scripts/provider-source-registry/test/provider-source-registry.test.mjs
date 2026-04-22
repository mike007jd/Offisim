import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCuratedCatalog,
  buildDiffReport,
  loadLiteLlmPayloads,
  mergeCatalog,
  normalizeCuratedOverridesSnapshot,
  normalizeLiteLlmSnapshot,
  normalizeOfficialFixturesSnapshot,
} from '../lib/catalog.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures', import.meta.url));
const GENERATED_AT = '2026-04-22T00:00:00.000Z';

const OFFICIAL_SOURCE = {
  sourceId: 'official-fixtures',
  sourceKind: 'official-static',
  trustTier: 'official',
  refreshMode: 'fixture',
};

const COMMUNITY_SOURCE = {
  sourceId: 'litellm',
  sourceKind: 'community-aggregator',
  trustTier: 'community',
  refreshMode: 'remote-json',
};

const OVERRIDE_SOURCE = {
  sourceId: 'offisim-curated-overrides',
  sourceKind: 'curated-override',
  trustTier: 'override',
  refreshMode: 'manual',
};

test('LiteLLM model metadata merges with provenance and emits reviewable diffs', async () => {
  const officialFixtures = {
    version: 1,
    providers: {
      'gemini-openai-general': {
        productName: 'Google Gemini',
        communityAliases: ['gemini'],
        defaultModel: 'gemini-2.5-flash',
        models: {
          'gemini-2.5-flash': {
            displayName: 'Gemini 2.5 Flash',
          },
        },
      },
      'kimi-intl-openai-general': {
        productName: 'Kimi Intl · General API',
        communityAliases: ['moonshot'],
        defaultModel: 'kimi-k2.5',
        models: {
          'kimi-k2.5': {
            displayName: 'Kimi K2.5',
          },
        },
      },
    },
  };
  const curatedOverrides = {
    version: 1,
    providers: {
      'gemini-openai-general': {
        executionLaneHints: {
          productExposed: ['gateway'],
        },
      },
    },
  };
  const registry = {
    version: 1,
    sources: [COMMUNITY_SOURCE, OFFICIAL_SOURCE, OVERRIDE_SOURCE],
  };

  const liteLlmPayloads = await loadLiteLlmPayloads(COMMUNITY_SOURCE, {
    fixtureDir: FIXTURE_DIR,
  });
  const officialSnapshot = normalizeOfficialFixturesSnapshot(officialFixtures, OFFICIAL_SOURCE);
  const communitySnapshot = normalizeLiteLlmSnapshot({
    officialFixtures,
    models: liteLlmPayloads.models,
    providerSupport: liteLlmPayloads.providerSupport,
    source: COMMUNITY_SOURCE,
  });
  const overrideSnapshot = normalizeCuratedOverridesSnapshot(curatedOverrides, OVERRIDE_SOURCE);
  const mergedCatalog = mergeCatalog({
    registry,
    snapshots: [communitySnapshot, officialSnapshot, overrideSnapshot],
    generatedAt: GENERATED_AT,
  });
  const curatedCatalog = buildCuratedCatalog({
    mergedCatalog,
    generatedAt: GENERATED_AT,
    officialSnapshot,
    overrideSnapshot,
  });
  const diffReport = buildDiffReport({
    officialSnapshot,
    communitySnapshot,
    mergedCatalog,
    generatedAt: GENERATED_AT,
  });

  assert.equal(
    mergedCatalog.providers['gemini-openai-general'].models['gemini-2.5-flash'].fields.contextWindow
      .provenance.sourceId,
    'litellm',
  );
  assert.deepEqual(
    curatedCatalog.providers['gemini-openai-general'].executionLaneHints.productExposed,
    ['gateway'],
  );
  assert.equal(
    curatedCatalog.providers['gemini-openai-general'].models['gemini-2.5-pro'],
    undefined,
  );
  assert.ok(
    diffReport.newModels.some(
      (entry) => entry.providerId === 'gemini-openai-general' && entry.modelId === 'gemini-2.5-pro',
    ),
  );
  assert.ok(diffReport.newProviderAliases.some((entry) => entry.communityAlias === 'mystery'));
});

test('lower-trust provider fields cannot silently replace official values', () => {
  const registry = {
    version: 1,
    sources: [COMMUNITY_SOURCE, OFFICIAL_SOURCE],
  };
  const communitySnapshot = {
    ...COMMUNITY_SOURCE,
    providers: {
      'anthropic-default': {
        fields: {
          baseURL: 'https://community.example/v1',
        },
        models: {},
      },
    },
  };
  const officialSnapshot = {
    ...OFFICIAL_SOURCE,
    providers: {
      'anthropic-default': {
        fields: {
          baseURL: 'https://api.anthropic.com',
        },
        models: {},
      },
    },
  };

  const mergedCatalog = mergeCatalog({
    registry,
    snapshots: [communitySnapshot, officialSnapshot],
    generatedAt: GENERATED_AT,
  });

  assert.equal(
    mergedCatalog.providers['anthropic-default'].fields.baseURL.value,
    'https://api.anthropic.com',
  );
  assert.ok(
    mergedCatalog.conflicts.some(
      (conflict) =>
        conflict.providerId === 'anthropic-default' &&
        conflict.field === 'baseURL' &&
        conflict.winner.provenance.sourceId === 'official-fixtures' &&
        conflict.loser.provenance.sourceId === 'litellm',
    ),
  );
});

test('curated overrides win with explicit provenance', () => {
  const registry = {
    version: 1,
    sources: [OFFICIAL_SOURCE, OVERRIDE_SOURCE],
  };
  const officialSnapshot = {
    ...OFFICIAL_SOURCE,
    providers: {
      'minimax-intl-anthropic-coding': {
        fields: {
          executionLaneHints: {
            productExposed: ['gateway', 'claude-agent-sdk'],
          },
        },
        models: {},
      },
    },
  };
  const overrideSnapshot = {
    ...OVERRIDE_SOURCE,
    providers: {
      'minimax-intl-anthropic-coding': {
        fields: {
          executionLaneHints: {
            productExposed: ['gateway'],
          },
        },
        models: {},
      },
    },
  };

  const mergedCatalog = mergeCatalog({
    registry,
    snapshots: [officialSnapshot, overrideSnapshot],
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(
    mergedCatalog.providers['minimax-intl-anthropic-coding'].fields.executionLaneHints.value,
    {
      productExposed: ['gateway'],
    },
  );
  assert.equal(
    mergedCatalog.providers['minimax-intl-anthropic-coding'].fields.executionLaneHints.provenance
      .sourceId,
    'offisim-curated-overrides',
  );
});
