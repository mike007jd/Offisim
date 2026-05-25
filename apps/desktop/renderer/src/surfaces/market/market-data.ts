import { resolveAsync } from '@/lib/platform.js';
import { useQuery } from '@tanstack/react-query';

/**
 * Market surface view-model + local query layer. Kept isolated from the shared
 * `@/data` contracts so the Market 1:1 redesign can carry the rich registry
 * shape (install state, permissions, lineage, changelog, drafts) without
 * widening the shared `Listing` type. Hooks resolve fixtures today through the
 * same `resolveAsync` seam used by `@/data/queries`, so the swap to sandboxed
 * registry commands is a query-fn change only.
 */

/** The full registry kind set. Superset of the shared `Listing` kinds — adds
 *  `sop`, which the marketplace catalogues but the shared view-model omits. */
export type ListingKind =
  | 'employee'
  | 'skill'
  | 'sop'
  | 'template'
  | 'layout'
  | 'prefab'
  | 'bundle';

/** Only employees and skills can be installed; other kinds are catalog-only. */
export const INSTALLABLE_KINDS = new Set<ListingKind>(['employee', 'skill']);

/** Marketplace mode: browse the registry vs. manage local packages/drafts. */
export type MarketMode = 'explore' | 'manage';
/** Manage sub-view. */
export type ManageView = 'installed' | 'updates' | 'published';

export type RiskClass = 'data' | 'logic' | 'system';
export type FsScope = 'none' | 'workspace' | 'system';
export type NetScope = 'none' | 'read' | 'full';
export type SecretScope = 'none' | 'declared';

export interface ListingPermissions {
  risk: RiskClass;
  filesystem: FsScope;
  network: NetScope;
  secrets: SecretScope;
}

export interface ListingRequirements {
  capabilities: string[];
  mcps: string[];
  models: string[];
  /** Minimum runtime semver, e.g. ">=0.7.0". */
  runtime: string;
  schema: number;
}

export interface ListingLineage {
  /** Origin slug, e.g. "growth-tools/teardown". */
  origin: string;
  /** Version this package was forked from, null when original. */
  forkedFrom: string | null;
}

export type ChangelogEntryKind = 'added' | 'fixed' | 'breaking' | 'note';

export interface ChangelogVersion {
  version: string;
  date: string;
  entries: Array<{ kind: ChangelogEntryKind; text: string }>;
}

/** One required model-profile binding slot surfaced in the install flow. */
export interface BindingSlot {
  id: string;
  /** Role label, e.g. "analyst". */
  role: string;
  hint: string;
  required: boolean;
  suggestions: string[];
}

export interface MarketListing {
  id: string;
  kind: ListingKind;
  /** Package slug, e.g. "growth-tools.teardown". */
  slug: string;
  name: string;
  summary: string;
  description: string;
  /** "@handle" creator (without the @). */
  handle: string;
  creatorName: string;
  /** Publisher is verified by the registry. */
  verified: boolean;
  rating: number;
  installs: number;
  version: string;
  /** All published versions, newest first. */
  versions: string[];
  publishedLabel: string;
  tags: string[];
  license: string;
  /** Avatar gradient endpoints for employee covers. */
  avatarA?: string;
  avatarB?: string;
  /** Two-letter initials for employee covers. */
  initials?: string;
  /** Tag glyphs for the employee cover viz. */
  coverTags?: string[];
  /** Whether the package is installed in the active company. */
  installed: boolean;
  permissions: ListingPermissions;
  requirements: ListingRequirements;
  lineage: ListingLineage;
  changelog: ChangelogVersion[];
  /** Screenshot URLs for the detail carousel. */
  screenshots: string[];
  /** Binding slots for the install Configure step. */
  bindings: BindingSlot[];
  /** Featured cards span two columns in the grid. */
  featured?: boolean;
}

/** A locally installed package row (Manage · Installed). */
export interface InstalledPackage {
  id: string;
  /** Package id slug, e.g. "offisim-labs/frontend-engineer". */
  packageId: string;
  version: string;
  installedLabel: string;
  /** Origin listing id; null for sideloaded packages (Check disabled). */
  originListingId: string | null;
  /** Latest available version when an update exists. */
  latestVersion: string | null;
  /** Update-check lifecycle. */
  checkState: 'idle' | 'checking' | 'error';
}

export type DraftStatus = 'draft' | 'validated' | 'submitted' | 'approved' | 'rejected';

/** A published / draft package row (Manage · Published). */
export interface PublishedDraft {
  id: string;
  title: string;
  summary: string | null;
  kind: ListingKind;
  updatedLabel: string;
  status: DraftStatus;
}

/** A company asset that can be packaged for publish (employee or skill). */
export interface PublishSource {
  id: string;
  kind: 'employee' | 'skill';
  /** Display name, e.g. "Senior Frontend Engineer". */
  name: string;
  /** Slug used to seed the package id, e.g. "frontend-engineer". */
  slug: string;
}

export interface RarityTone {
  /** rarity color token reference. */
  rc: string;
  rcs: string;
}

/** 1:1 with prototype getRarityColor(kind). */
export function getRarityTone(kind: ListingKind): RarityTone {
  switch (kind) {
    case 'employee':
      return { rc: 'var(--off-accent)', rcs: 'var(--off-accent-surface)' };
    case 'skill':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'template':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'layout':
      return { rc: 'var(--off-danger)', rcs: 'var(--off-danger-surface)' };
    case 'prefab':
      return { rc: 'var(--off-warn)', rcs: 'var(--off-warn-surface)' };
    default:
      return { rc: 'var(--off-ink-3)', rcs: 'var(--off-surface-sunken)' };
  }
}

export function compactInstalls(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/* ----------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------- */

const SHOT_A = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=720&q=70';
const SHOT_B = 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=720&q=70';
const SHOT_C = 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=720&q=70';

const marketListings: MarketListing[] = [
  {
    id: 'lst-fe-engineer',
    kind: 'employee',
    slug: 'offisim-labs.frontend-engineer',
    name: 'Senior Frontend Engineer',
    summary: 'React 19 specialist tuned for design-system work and accessibility passes.',
    description:
      'A senior frontend persona that pairs React 19 fluency with rigorous design-system and accessibility discipline. Ships component work with a11y audits baked into every pass.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.8,
    installs: 3200,
    version: '1.2.0',
    versions: ['1.2.0', '1.1.0', '1.0.0'],
    publishedLabel: '4/02/26',
    tags: ['frontend', 'react', 'design-system'],
    license: 'MIT',
    avatarA: '#6a8dff',
    avatarB: '#3a5fd0',
    initials: 'SF',
    coverTags: ['react·19', 'a11y', 'design-sys'],
    installed: true,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'none', secrets: 'declared' },
    requirements: {
      capabilities: ['code.write', 'code.read'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'offisim-labs/frontend-engineer', forkedFrom: null },
    changelog: [
      {
        version: '1.2.0',
        date: '4/02/26',
        entries: [
          { kind: 'breaking', text: 'filesystem_scope widened from none to workspace' },
          { kind: 'added', text: 'Accessibility audit sub-pass before sign-off' },
          { kind: 'fixed', text: 'React 19 server-component prompt drift' },
        ],
      },
      {
        version: '1.1.0',
        date: '3/01/26',
        entries: [{ kind: 'added', text: 'Design-token review checklist' }],
      },
    ],
    screenshots: [SHOT_A, SHOT_B, SHOT_C],
    bindings: [
      {
        id: 'b-primary',
        role: 'engineer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-flash'],
      },
    ],
    featured: true,
  },
  {
    id: 'lst-teardown',
    kind: 'skill',
    slug: 'growth-tools.teardown',
    name: 'Competitive Teardown',
    summary: 'Structured market + competitor analysis, graded teardown report.',
    description:
      'Walks a target market, enumerates direct + adjacent competitors, scores each on positioning, pricing, and moat, then renders a severity-graded teardown the boss can act on.',
    handle: 'growth-tools',
    creatorName: 'Growth Tools',
    verified: false,
    rating: 4.6,
    installs: 980,
    version: '0.4.0',
    versions: ['0.4.0', '0.3.0', '0.2.1'],
    publishedLabel: '3/14/26',
    tags: ['analysis', 'growth', 'research'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'read', secrets: 'none' },
    requirements: {
      capabilities: ['web.search', 'doc.export'],
      mcps: ['context7'],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'growth-tools/teardown', forkedFrom: '0.2.1' },
    changelog: [
      {
        version: '0.4.0',
        date: '3/14/26',
        entries: [
          { kind: 'added', text: 'Adjacent-competitor enumeration pass' },
          { kind: 'fixed', text: 'Pricing-tier extraction misses' },
        ],
      },
    ],
    screenshots: [SHOT_A, SHOT_B, SHOT_C],
    bindings: [
      {
        id: 'b-analyst',
        role: 'analyst',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: ['openai/gpt-4o', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-4'],
      },
      {
        id: 'b-summarizer',
        role: 'summarizer',
        hint: 'Cheap recap pass',
        required: false,
        suggestions: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'],
      },
    ],
  },
  {
    id: 'lst-delivery-pipeline',
    kind: 'sop',
    slug: 'ops-collective.delivery-pipeline',
    name: 'Feature Delivery Pipeline',
    summary: '5-step DAG covering requirements → design → build → QA → release sign-off.',
    description:
      'A five-stage delivery DAG that routes work from product requirements through design, build, QA, and a release sign-off gate, with role hand-offs wired between each step.',
    handle: 'ops-collective',
    creatorName: 'Ops Collective',
    verified: true,
    rating: 4.9,
    installs: 12000,
    version: '2.0.0',
    versions: ['2.0.0', '1.4.0'],
    publishedLabel: '2/11/26',
    tags: ['workflow', 'delivery', 'dag'],
    license: 'Apache-2.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: {
      capabilities: [],
      mcps: [],
      models: [],
      runtime: '>=0.6.0',
      schema: 1,
    },
    lineage: { origin: 'ops-collective/delivery-pipeline', forkedFrom: null },
    changelog: [
      {
        version: '2.0.0',
        date: '2/11/26',
        entries: [{ kind: 'breaking', text: 'Release gate now requires sign-off role' }],
      },
    ],
    screenshots: [SHOT_C, SHOT_A],
    bindings: [],
  },
  {
    id: 'lst-product-studio',
    kind: 'template',
    slug: 'offisim-labs.lean-product-studio',
    name: 'Lean Product Studio',
    summary: '6-role studio blueprint with pre-wired zones and a delivery SOP bundle.',
    description:
      'A ready-to-run product studio: six roles, pre-wired office zones, and a bundled delivery SOP so a new company is productive from the first run.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.7,
    installs: 5400,
    version: '1.3.0',
    versions: ['1.3.0', '1.2.0'],
    publishedLabel: '4/18/26',
    tags: ['studio', 'blueprint', 'product'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.7.0', schema: 1 },
    lineage: { origin: 'offisim-labs/lean-product-studio', forkedFrom: null },
    changelog: [
      {
        version: '1.3.0',
        date: '4/18/26',
        entries: [{ kind: 'added', text: 'Ops role + breakout zone' }],
      },
    ],
    screenshots: [SHOT_C],
    bindings: [],
  },
  {
    id: 'lst-open-loft',
    kind: 'layout',
    slug: 'studio-kits.open-loft-24',
    name: 'Open Loft 24',
    summary: 'Warehouse-style floor plan with breakout zones and a central pitch hall.',
    description:
      'A warehouse-style open floor plan: clustered desks, two breakout zones, and a central pitch hall sized for company-wide demos.',
    handle: 'studio-kits',
    creatorName: 'Studio Kits',
    verified: false,
    rating: 4.3,
    installs: 760,
    version: '1.0.0',
    versions: ['1.0.0'],
    publishedLabel: '1/22/26',
    tags: ['layout', 'open-plan', 'pitch-hall'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'studio-kits/open-loft-24', forkedFrom: null },
    changelog: [
      {
        version: '1.0.0',
        date: '1/22/26',
        entries: [{ kind: 'added', text: 'Initial release' }],
      },
    ],
    screenshots: [SHOT_A],
    bindings: [],
  },
  {
    id: 'lst-desk-cluster',
    kind: 'prefab',
    slug: 'props-bay.desk-cluster',
    name: 'Standing Desk Cluster',
    summary: '4-seat standing desk pod prefab with anchor + footprint spatial spec.',
    description:
      'A four-seat standing desk pod prefab with anchor point and footprint spec, ready to drop into any zone in the Studio editor.',
    handle: 'props-bay',
    creatorName: 'Props Bay',
    verified: false,
    rating: 4.1,
    installs: 410,
    version: '0.9.0',
    versions: ['0.9.0'],
    publishedLabel: '1/30/26',
    tags: ['prefab', 'desk', 'pod'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'props-bay/desk-cluster', forkedFrom: null },
    changelog: [
      { version: '0.9.0', date: '1/30/26', entries: [{ kind: 'added', text: 'Initial release' }] },
    ],
    screenshots: [SHOT_B],
    bindings: [],
  },
  {
    id: 'lst-indie-kit',
    kind: 'bundle',
    slug: 'indie-maker.launch-kit',
    name: 'Indie Launch Kit',
    summary: 'Bundle pairing a growth employee with a launch-checklist SOP for solo founders.',
    description:
      'A starter bundle for solo founders: a growth-focused employee paired with a launch-checklist SOP, so a one-person company can run a launch end to end.',
    handle: 'indie-maker',
    creatorName: 'Indie Maker',
    verified: false,
    rating: 3.9,
    installs: 120,
    version: '0.2.0',
    versions: ['0.2.0', '0.1.0'],
    publishedLabel: '5/01/26',
    tags: ['bundle', 'launch', 'indie'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'read', secrets: 'declared' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.7.0', schema: 1 },
    lineage: { origin: 'indie-maker/launch-kit', forkedFrom: null },
    changelog: [
      { version: '0.2.0', date: '5/01/26', entries: [{ kind: 'added', text: 'Launch SOP' }] },
    ],
    screenshots: [SHOT_C],
    bindings: [],
  },
  {
    id: 'lst-qa-lead',
    kind: 'employee',
    slug: 'offisim-labs.qa-automation-lead',
    name: 'QA Automation Lead',
    summary: 'Regression-first QA persona — writes characterization tests before sign-off.',
    description:
      'A regression-first QA lead that writes characterization tests before any sign-off, then drives an accessibility audit pass on top.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.5,
    installs: 2100,
    version: '1.0.0',
    versions: ['1.0.0'],
    publishedLabel: '4/28/26',
    tags: ['qa', 'testing', 'regression'],
    license: 'MIT',
    avatarA: '#2f9f6a',
    avatarB: '#1c7a4c',
    initials: 'QA',
    coverTags: ['regression', 'char-tests', 'a11y-audit'],
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'none', secrets: 'none' },
    requirements: {
      capabilities: ['code.read', 'test.run'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'offisim-labs/qa-automation-lead', forkedFrom: null },
    changelog: [
      { version: '1.0.0', date: '4/28/26', entries: [{ kind: 'added', text: 'Initial release' }] },
    ],
    screenshots: [SHOT_B, SHOT_A],
    bindings: [
      {
        id: 'b-qa',
        role: 'qa-engineer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
      },
    ],
  },
  {
    id: 'lst-pr-review',
    kind: 'skill',
    slug: 'dx-labs.pr-review-pass',
    name: 'PR Review Pass',
    summary: 'Senior-developer-style review with severity tags and a dedup pass.',
    description:
      'A senior-developer-style review skill that reads a diff, flags issues with severity tags, and runs a dedup pass before emitting a review summary.',
    handle: 'dx-labs',
    creatorName: 'DX Labs',
    verified: true,
    rating: 4.4,
    installs: 540,
    version: '0.6.0',
    versions: ['0.6.0', '0.5.0'],
    publishedLabel: '4/05/26',
    tags: ['review', 'code', 'severity'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'read', secrets: 'none' },
    requirements: {
      capabilities: ['code.read', 'diff.severity'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'dx-labs/pr-review-pass', forkedFrom: null },
    changelog: [
      { version: '0.6.0', date: '4/05/26', entries: [{ kind: 'fixed', text: 'Dedup false hits' }] },
    ],
    screenshots: [SHOT_A, SHOT_C],
    bindings: [
      {
        id: 'b-reviewer',
        role: 'reviewer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
      },
    ],
  },
  {
    id: 'lst-pitch-stage',
    kind: 'prefab',
    slug: 'props-bay.pitch-hall-stage',
    name: 'Pitch Hall Stage',
    summary: 'Floor-mounted stage + AV rack with a 4-seat front row.',
    description:
      'A floor-mounted pitch stage prefab with an AV rack and a four-seat front row, sized for the central pitch hall in open-plan layouts.',
    handle: 'props-bay',
    creatorName: 'Props Bay',
    verified: false,
    rating: 4.0,
    installs: 230,
    version: '0.3.0',
    versions: ['0.3.0'],
    publishedLabel: '2/28/26',
    tags: ['prefab', 'stage', 'pitch'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'props-bay/pitch-hall-stage', forkedFrom: null },
    changelog: [
      { version: '0.3.0', date: '2/28/26', entries: [{ kind: 'added', text: 'AV rack' }] },
    ],
    screenshots: [SHOT_B],
    bindings: [],
  },
];

const installedPackages: InstalledPackage[] = [
  {
    id: 'inst-fe',
    packageId: 'offisim-labs/frontend-engineer',
    version: '1.1.0',
    installedLabel: '4/02/26',
    originListingId: 'lst-fe-engineer',
    latestVersion: '1.2.0',
    checkState: 'idle',
  },
  {
    id: 'inst-teardown',
    packageId: 'growth-tools/teardown',
    version: '0.4.0',
    installedLabel: '3/20/26',
    originListingId: 'lst-teardown',
    latestVersion: null,
    checkState: 'idle',
  },
  {
    id: 'inst-launch-kit',
    packageId: 'ops-collective/launch-kit',
    version: '2.0.0',
    installedLabel: '2/11/26',
    originListingId: 'lst-indie-kit',
    latestVersion: null,
    checkState: 'idle',
  },
  {
    id: 'inst-desk-cluster',
    packageId: 'props-bay/desk-cluster',
    version: '0.9.0',
    installedLabel: '1/30/26',
    originListingId: 'lst-desk-cluster',
    latestVersion: null,
    checkState: 'error',
  },
  {
    id: 'inst-sideload',
    packageId: 'sideloaded/local-pack',
    version: '0.1.0',
    installedLabel: '5/01/26',
    originListingId: null,
    latestVersion: null,
    checkState: 'idle',
  },
];

const publishedDrafts: PublishedDraft[] = [
  {
    id: 'drf-fe',
    title: 'Senior Frontend Engineer',
    summary: 'React 19 specialist employee package',
    kind: 'employee',
    updatedLabel: '5/12/26',
    status: 'approved',
  },
  {
    id: 'drf-teardown',
    title: 'Competitive Teardown',
    summary: 'Market analysis skill',
    kind: 'skill',
    updatedLabel: '5/09/26',
    status: 'submitted',
  },
  {
    id: 'drf-untitled',
    title: 'Untitled draft',
    summary: null,
    kind: 'employee',
    updatedLabel: '5/14/26',
    status: 'draft',
  },
  {
    id: 'drf-qa',
    title: 'QA Automation Lead',
    summary: 'Regression-first QA persona',
    kind: 'employee',
    updatedLabel: '4/28/26',
    status: 'rejected',
  },
];

const publishSources: PublishSource[] = [
  { id: 'src-fe', kind: 'employee', name: 'Senior Frontend Engineer', slug: 'frontend-engineer' },
  { id: 'src-qa', kind: 'employee', name: 'QA Automation Lead', slug: 'qa-automation-lead' },
  { id: 'src-teardown', kind: 'skill', name: 'Competitive Teardown', slug: 'teardown' },
  { id: 'src-review', kind: 'skill', name: 'PR Review Pass', slug: 'pr-review-pass' },
];

/* ----------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------- */

export function useMarketListings() {
  return useQuery({
    queryKey: ['market-listings'],
    queryFn: () => resolveAsync(marketListings),
  });
}

export function useInstalledPackages() {
  return useQuery({
    queryKey: ['market-installed'],
    queryFn: () => resolveAsync(installedPackages),
  });
}

export function usePublishedDrafts() {
  return useQuery({
    queryKey: ['market-drafts'],
    queryFn: () => resolveAsync(publishedDrafts),
  });
}

export function usePublishSources() {
  return useQuery({
    queryKey: ['market-publish-sources'],
    queryFn: () => resolveAsync(publishSources),
  });
}
