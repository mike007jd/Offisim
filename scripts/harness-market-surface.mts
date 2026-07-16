import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  InstalledPackage,
  PublishedDraft,
  RegistryConnectionState,
} from '../apps/desktop/renderer/src/surfaces/market/market-data.js';
import {
  filterInstalledPackages,
  filterPublishedDrafts,
  marketConnectionCopy,
  marketSearchPlaceholder,
} from '../apps/desktop/renderer/src/surfaces/market/market-presentation.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;

function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`✓ ${name}`);
}

const installed: InstalledPackage[] = [
  {
    id: 'one',
    packageId: 'com.acme.note-reader',
    version: '1.0.0',
    installedLabel: 'Jul 16, 2026',
    originListingId: null,
    latestVersion: null,
    checkState: 'idle',
  },
  {
    id: 'two',
    packageId: 'team.skill.release-review',
    version: '2.1.0',
    installedLabel: 'Jul 16, 2026',
    originListingId: 'listing-two',
    latestVersion: '2.2.0',
    checkState: 'idle',
  },
];

const submissions: PublishedDraft[] = [
  {
    id: 'draft-one',
    title: 'Release reviewer',
    summary: 'Checks release evidence',
    kind: 'skill',
    updatedLabel: 'Jul 16, 2026',
    status: 'submitted',
  },
  {
    id: 'draft-two',
    title: 'Support lead',
    summary: 'Triages customer requests',
    kind: 'employee',
    updatedLabel: 'Jul 16, 2026',
    status: 'approved',
  },
];

check('offline installed search matches the readable item name', () => {
  assert.deepEqual(
    filterInstalledPackages(installed, 'note reader', false).map((item) => item.id),
    ['one'],
  );
});

check('updates view keeps only items with a newer version', () => {
  assert.deepEqual(
    filterInstalledPackages(installed, '', true).map((item) => item.id),
    ['two'],
  );
});

check('installed search still matches version and internal id fragments', () => {
  assert.deepEqual(
    filterInstalledPackages(installed, '2.2', false).map((item) => item.id),
    ['two'],
  );
});

check('submission search covers title, summary, kind, and review status', () => {
  assert.deepEqual(
    filterPublishedDrafts(submissions, 'customer').map((draft) => draft.id),
    ['draft-two'],
  );
  assert.deepEqual(
    filterPublishedDrafts(submissions, 'submitted').map((draft) => draft.id),
    ['draft-one'],
  );
});

check('search placeholder follows the user task without technical vocabulary', () => {
  assert.equal(marketSearchPlaceholder('explore', 'installed'), 'Search Market…');
  assert.equal(marketSearchPlaceholder('manage', 'installed'), 'Search installed items…');
  assert.equal(marketSearchPlaceholder('manage', 'published'), 'Search submissions…');
});

check('all disconnected states use user language', () => {
  const reasons: RegistryConnectionState['reason'][] = [
    'registry-config-missing',
    'auth-not-configured',
    'creator-missing',
    'platform-unreachable',
    'desktop-runtime-unavailable',
  ];
  for (const reason of reasons) {
    const copy = marketConnectionCopy({ connected: false, reason });
    assert.doesNotMatch(
      `${copy.title} ${copy.description}`,
      /registry|token|endpoint|receipt|job id/i,
    );
  }
});

const marketSurface = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx'),
  'utf8',
);
const marketManage = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/market/MarketManage.tsx'),
  'utf8',
);
const publishDialog = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/market/PublishDialog.tsx'),
  'utf8',
);
const installDialog = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/market/InstallDialog.tsx'),
  'utf8',
);
const settingsSurface = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/settings/SettingsSurface.tsx'),
  'utf8',
);
const advancedPane = readFileSync(
  join(root, 'apps/desktop/renderer/src/surfaces/settings/AdvancedConnectionsPane.tsx'),
  'utf8',
);

check('Browse and Installed render before the always-present search field', () => {
  const toolbarStart = marketSurface.indexOf('<div className="off-mkt-fbar-main">');
  const toolbar = marketSurface.slice(toolbarStart, marketSurface.indexOf('</div>', toolbarStart));
  assert.ok(toolbar.indexOf('options={MODE_TABS}') < toolbar.indexOf('<SearchInput'));
  assert.doesNotMatch(marketSurface, /off-mkt-search-placeholder/);
});

check('the same query reaches installed and published local views', () => {
  assert.match(marketSurface, /<MarketManage[\s\S]*?query=\{query\}/);
  assert.match(marketManage, /filterInstalledPackages\(rows, query/);
  assert.match(marketManage, /filterPublishedDrafts\(drafts\.data \?\? \[\], query\)/);
});

check('Market main flow does not expose connection implementation terms', () => {
  const combined = `${marketSurface}\n${marketManage}\n${publishDialog}\n${installDialog}`;
  for (const forbidden of [
    'Registry Token',
    'Connect registry',
    'Registry endpoint',
    'registry receipt',
    'moderation job',
    'Checking registry drafts',
    'No registry drafts',
    'Risk class',
    'Description / README',
    'Configure Bindings',
    'Fetching artifact and applying bindings',
    'Required MCP Servers',
  ]) {
    assert.ok(!combined.includes(forbidden), `unexpected main-flow copy: ${forbidden}`);
  }
});

check('endpoint and token live only in Advanced connection settings', () => {
  assert.match(settingsSurface, /key: 'advanced', label: 'Advanced'/);
  assert.match(advancedPane, /Advanced connections/);
  assert.match(advancedPane, /label="Endpoint"/);
  assert.match(advancedPane, /label="Access token"/);
  assert.match(marketSurface, /openSettings\('advanced'\)/);
});

console.log(`\nMarket surface harness: ${passed}/10 checks passed`);
