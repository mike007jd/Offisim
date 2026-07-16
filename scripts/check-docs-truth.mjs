#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<')) {
    const closing = target.indexOf('>');
    target = closing >= 0 ? target.slice(1, closing) : target.slice(1);
  } else {
    target = target.replace(/\s+["'][^"']*["']\s*$/u, '').trim();
  }

  if (/^(?:https?:|mailto:|data:|app:|#)/iu.test(target)) return null;
  target = target.split('#', 1)[0].split('?', 1)[0];
  if (!target) return null;

  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function verifyTarget(sourcePath, rawTarget) {
  const target = localTarget(rawTarget);
  if (!target) return;
  const absoluteTarget = target.startsWith('/')
    ? resolve(ROOT, `.${target}`)
    : resolve(ROOT, dirname(sourcePath), target);
  check(existsSync(absoluteTarget), `Broken local link: ${sourcePath} -> ${rawTarget}`);
}

const trackedDocs = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.mdx'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

for (const relativePath of trackedDocs) {
  const withoutCodeFences = read(relativePath).replace(/```[\s\S]*?```/gu, '');
  for (const match of withoutCodeFences.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/gu)) {
    verifyTarget(relativePath, match[1]);
  }
}

const currentDocs = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'SECURITY.md',
  'apps/desktop/CLAUDE.md',
  'packages/core/CLAUDE.md',
  'Docs/SYSTEM_FRAMEWORK.md',
  'Docs/FEATURES.md',
  'Docs/CODEBASE_MAP.md',
  'Docs/HARNESS_ARCHITECTURE.md',
  'Docs/UI_FRAMEWORK_STACK.md',
  'Docs/design/.v3-dna-brief.md',
  'Docs/00_start_here/LOCAL_DEVELOPMENT.md',
  'Docs/00_start_here/RELEASE_GATES.md',
  'Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md',
  'Docs/architecture/2026-07-13-native-stage-capability-lanes.md',
  'Docs/architecture/2026-07-02-prelaunch-vibe-debt-policy.md',
  'Docs/architecture/2026-06-26-collaboration-domain-boundary.md',
  'Docs/architecture/2026-06-26-enhance-profile-contract.md',
  'Docs/architecture/2026-06-26-loop-domain-mission-adapter.md',
  'Docs/roadmap/2026-07-13-ui-ux-consistency-pass/plan.md',
  'Docs/roadmap/2026-07-13-ui-ux-consistency-pass/tasks.md',
];

const staleCurrentClaims = [
  /Offisim has one active AI runtime:\s*Pi Agent/iu,
  /Pi Agent is the only active runtime/iu,
  /Pi-only runtime guards/iu,
  /Pi Agent owns AI runtime choice/iu,
  /current Pi adapter remains the only shipped engine/iu,
  /Provider auth and model configuration are managed by Pi Agent/iu,
  /Offisim does not (?:store provider API keys or )?maintain a provider\/model catalog/iu,
  /live chat still assembles[\s\S]{0,80}DesktopPiAgentRuntime/iu,
  /Claude\/Codex\/OpenAI sidecar lanes are not active/iu,
  /Codex(?: CLI)? subscription(?:-engine| engine| adapter| host)/iu,
  /Claude(?: Code)? subscription(?: engine| adapter| host)/iu,
  /complete API and Codex subscription/iu,
  /subscription engines? (?:are shipped|reuse native login)/iu,
  /bundled (?:official )?(?:native )?Codex(?: app-server| sidecar| binary)/iu,
  /Codex[^\n]{0,120}(?:account\/model discovery|provider-native Usage)/iu,
  /Claude[\s\S]{0,160}(?:remaining\/reset\/credits|provider-native Usage)/iu,
];

for (const relativePath of currentDocs) {
  const text = read(relativePath);
  for (const pattern of staleCurrentClaims) {
    check(!pattern.test(text), `Stale current claim in ${relativePath}: ${pattern}`);
  }
}

const currentTruth = currentDocs.map(read).join('\n');
const durableContracts = [
  [
    /Pi API[\s\S]{0,180}Codex[\s\S]{0,180}Claude Code[\s\S]{0,180}(?:implemented|shipped|已交付)/iu,
    'Pi API plus Codex and Claude Code orchestration implementation truth',
  ],
  [
    /Claude Code[\s\S]{0,180}(?:implemented|shipped|已交付|completed)/iu,
    'Claude Code orchestration implementation truth',
  ],
  [/Pi(?:'s)?[\s\S]{0,100}models\.json/iu, 'Pi dynamic provider and model truth'],
  [
    /(?:provider\/model (?:editing|配置)|(?:edit|编辑)[^\n]{0,100}provider\/model)/iu,
    'Pi provider and model editing',
  ],
  [
    /Codex[\s\S]{0,160}(?:detect|检测)[\s\S]{0,220}(?:app-server|spawn|启动)[\s\S]{0,220}(?:event|事件)[\s\S]{0,160}Stop/iu,
    'Codex detection spawn event stream and Stop',
  ],
  [
    /Claude Code[\s\S]{0,180}(?:detect|检测)[\s\S]{0,260}(?:stream-json|spawn|启动)[\s\S]{0,260}(?:event|事件)[\s\S]{0,180}Stop/iu,
    'Claude Code detection spawn event stream and Stop',
  ],
  [
    /external\s+CLI[\s\S]{0,180}(?:credentials|凭据)[\s\S]{0,180}(?:model choice|模型)[\s\S]{0,180}(?:CLI-owned|自管|own)/iu,
    'external CLI credential and model ownership',
  ],
  [
    /(?:task|任务)[\s\S]{0,120}(?:token|令牌)[\s\S]{0,120}(?:duration|时长)[\s\S]{0,160}订阅内 · 无 API 成本/iu,
    'orchestration task token duration and no API cost',
  ],
  [/Project[\s\S]{0,120}(?:catalog|目录)/iu, 'Project folder catalog layer'],
  [/Offisim Conversation/iu, 'Offisim Conversation layer'],
  [/Native Agent Home \/ Session \/ Memory/iu, 'native Agent Home/session/memory layer'],
  [/effective task workspace/iu, 'effective task workspace layer'],
  [/API[\s\S]{0,160}(?:token|Usage)[\s\S]{0,160}Cost/iu, 'API token and Cost accounting'],
  [
    /user-configured[\s\S]{0,160}(?:source metadata|source)[\s\S]{0,80}optional/iu,
    'user-configured API model source is optional',
  ],
  [/repeatable process in natural language/iu, 'Loops natural-language authoring'],
  [/Purpose: browse, preview, publish, review, and install/iu, 'Market user-language flow'],
  [/Office dramaturgy/iu, 'Office dramaturgy preservation'],
];

for (const [pattern, label] of durableContracts) {
  check(pattern.test(currentTruth), `Missing durable documentation contract: ${label}`);
}

const supersededMarkdown = [
  [
    'Docs/architecture/2026-06-18-pi-agent-only-runtime.md',
    '2026-07-13-engine-neutral-ai-accounts.md',
  ],
  [
    'Docs/architecture/2026-06-25-pi-0.80-compat-spike.md',
    '2026-07-13-engine-neutral-ai-accounts.md',
  ],
  ['Docs/architecture/2026-06-25-truth-closure.md', '2026-07-13-engine-neutral-ai-accounts.md'],
  ['Docs/DELEGATION_ARCHITECTURE.md', 'HARNESS_ARCHITECTURE.md'],
  ['Docs/test-loops/codex-functional-test-loop.md', 'RELEASE_GATES.md'],
  ['Docs/roadmap/2026-07-01-parallel-work-dramaturgy-prd.md', '2026-07-13-ui-ux-consistency-pass'],
  [
    'Docs/roadmap/2026-07-01-universal-work-dramaturgy-iteration-plan.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  ['Docs/roadmap/2026-07-02-dramaturgy-state-coverage.md', '2026-07-13-ui-ux-consistency-pass'],
  [
    'Docs/roadmap/2026-07-02-production-work-dramaturgy-prd.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-02-stage-preview-computer-use-prd.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-03-agent-workspace-execution-plan.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-03-agent-workspace-requirements-package.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-03-stage-preview-computer-use-plan.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-09-architecture-quality-refactor-pr-plan.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-09-office-toy-performance-requirements.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  [
    'Docs/roadmap/2026-07-09-office-toy-performance-execution-plan.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  ['Docs/roadmap/plan-office-toy-performance-overhaul.md', '2026-07-13-ui-ux-consistency-pass'],
  ['Docs/roadmap/2026-07-11-vibe-coding-company-roadmap.md', '2026-07-13-ui-ux-consistency-pass'],
  ['Docs/roadmap/2026-07-12-shell-ia-and-character-lane.md', '2026-07-13-ui-ux-consistency-pass'],
  [
    'Docs/archive/2026-06-25-second-runtime-pilot-scorecard.md',
    '2026-07-13-engine-neutral-ai-accounts.md',
  ],
  [
    'Docs/archive/2026-06-26-verified-missions-remediation-roadmap.md',
    '2026-07-13-ui-ux-consistency-pass',
  ],
  ['Docs/archive/2026-06-29-agent-harness-wave-status.md', 'HARNESS_ARCHITECTURE.md'],
  ['Docs/live-verify-report-2026-06-30.md', '2026-07-13-ui-ux-consistency-pass'],
  ['Docs/live-verify-bugs-2026-06-30.md', '2026-07-13-ui-ux-consistency-pass'],
  ['Docs/live-verify-report-2026-07-12-shell-lane.md', '2026-07-13-ui-ux-consistency-pass'],
];

for (const [relativePath, replacement] of supersededMarkdown) {
  const banner = read(relativePath).slice(0, 1800);
  check(
    /(?:superseded|historical|历史)/iu.test(banner),
    `Missing superseded banner: ${relativePath}`,
  );
  check(
    banner.includes(replacement),
    `Missing current replacement link in ${relativePath}: ${replacement}`,
  );
}

const supersededPrototypes = [
  'Docs/design/offisim-activity-prototype.html',
  'Docs/design/offisim-lifecycle-prototype.html',
  'Docs/design/offisim-market-prototype.html',
  'Docs/design/offisim-personnel-prototype.html',
  'Docs/design/offisim-settings-prototype.html',
  'Docs/design/offisim-states-prototype.html',
  'Docs/design/offisim-workspace-prototype.html',
];

for (const relativePath of supersededPrototypes) {
  const text = read(relativePath);
  check(
    text.includes('data-v3-superseded="true"'),
    `Missing visible prototype banner: ${relativePath}`,
  );
  check(text.includes('.v3-dna-brief.md'), `Missing V3 replacement link: ${relativePath}`);
  for (const match of text.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)) {
    verifyTarget(relativePath, match[1]);
  }
}

const officePrototype = 'Docs/design/offisim-office-layout-v3-prototype.html';
const officePrototypeText = read(officePrototype);
check(
  officePrototypeText.includes('data-v3-visual-only="true"'),
  'The canonical Office specimen must disclose that behavior/copy examples are historical.',
);
for (const replacement of [
  '2026-07-13-ui-ux-consistency-pass/tasks.md',
  '2026-07-13-engine-neutral-ai-accounts.md',
]) {
  check(
    officePrototypeText.includes(replacement),
    `Office specimen missing current link: ${replacement}`,
  );
}
for (const match of officePrototypeText.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)) {
  verifyTarget(officePrototype, match[1]);
}

const ledger = read('Docs/document-truth-ledger.md');
for (const relativePath of [
  ...currentDocs,
  ...supersededMarkdown.map(([path]) => path),
  ...supersededPrototypes,
]) {
  check(
    ledger.includes(`\`${relativePath}\``),
    `Document missing from truth ledger: ${relativePath}`,
  );
}
check(
  ledger.includes(`\`${officePrototype}\``),
  `Document missing from truth ledger: ${officePrototype}`,
);
check(ledger.includes('DELETE — none'), 'Truth ledger must record the skeptic deletion verdict.');
check(ledger.includes('Tracked screenshots'), 'Truth ledger must record screenshot retention.');

if (failures.length > 0) {
  console.error(`[check-docs-truth] failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `[check-docs-truth] ok (${trackedDocs.length} Markdown files, ${currentDocs.length} current sources, ${supersededMarkdown.length + supersededPrototypes.length} superseded records)`,
);
