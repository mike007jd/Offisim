/**
 * Authoritative package harness catalog.
 *
 * Every package.json harness:* id is represented exactly once. command preserves
 * the pre-manifest invocation byte-for-byte; the explicit runner/file metadata
 * lets audits reason about Node, tsx, loader, composite, and Cargo entries
 * without reverse-parsing package.json. Composite steps remain simple ordered
 * shell commands—this is a manifest, not a second scheduler.
 *
 * Load-time integrity rejects duplicate harness ids, duplicate validate roots,
 * unknown nested refs, cycles, and legacy/composite double execution so
 * `validateHarnessIds` expands to one deterministic acyclic plan.
 */
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'node'|'tsx'|'cargo'} HarnessRunner
 * @typedef {Object} HarnessManifestEntry
 * @property {string} id
 * @property {string} file
 * @property {HarnessRunner} runner
 * @property {string} command
 * @property {boolean} composite
 * @property {string[]} [steps]
 * @property {string} [cwdFilter]
 * @property {string} [tsconfig]
 * @property {string} [nodeOptions]
 * @property {boolean} [sharedRunner]
 */

/** @type {readonly HarnessManifestEntry[]} */
export const harnessManifest = Object.freeze([
  {
    id: 'codex-app-server-contract',
    file: 'scripts/harness-codex-app-server-contract.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-codex-app-server-contract.mjs',
  },
  {
    id: 'claude-agent-host',
    file: 'scripts/harness-claude-agent-host.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-claude-agent-host.mjs',
  },
  {
    id: 'codex-runtime-conformance',
    file: 'apps/desktop/src-tauri/Cargo.toml',
    runner: 'cargo',
    composite: true,
    steps: [
      'pnpm prepare:desktop-cargo-test',
      'cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml codex_agent_host:: --lib',
    ],
    command:
      'pnpm prepare:desktop-cargo-test && cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml codex_agent_host:: --lib',
  },
  {
    id: 'doc-engine',
    file: 'scripts/harness-doc-engine-parsers.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-doc-engine-parsers.mjs',
  },
  {
    id: 'git-workbench-parser',
    file: 'scripts/harness-git-workbench-parser.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-git-workbench-parser.mts',
  },
  {
    id: 'chat-attachment-roundtrip',
    file: 'scripts/harness-chat-attachment-roundtrip.mjs',
    runner: 'node',
    cwdFilter: '@offisim/core',
    composite: true,
    steps: [
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json',
      'node scripts/harness-chat-attachment-roundtrip.mjs',
    ],
    command:
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json && node scripts/harness-chat-attachment-roundtrip.mjs',
  },
  {
    id: 'best-of-n',
    file: 'scripts/harness-best-of-n.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-best-of-n.mts',
  },
  {
    id: 'project-workspace',
    file: 'scripts/harness-project-workspace.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-project-workspace.mts',
  },
  {
    id: 'workspace-panel-project-gate',
    file: 'scripts/harness-workspace-panel-project-gate.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-workspace-panel-project-gate.mjs',
  },
  {
    id: 'platform-zod-contract',
    file: 'scripts/harness-platform-zod-contract.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-platform-zod-contract.mts',
  },
  {
    id: 'conversation-run-controller',
    file: 'scripts/harness-conversation-run-controller.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-conversation-run-controller.mts',
  },
  {
    id: 'conversation-deletion',
    file: 'scripts/harness-conversation-deletion.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-conversation-deletion.mts',
  },
  {
    id: 'thread-lifecycle-guard',
    file: 'scripts/harness-thread-lifecycle-guard.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-thread-lifecycle-guard.mts',
  },
  {
    id: 'workspace-chat-presentation',
    file: 'scripts/harness-workspace-chat-presentation.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-workspace-chat-presentation.mts',
  },
  {
    id: 'chat-persistence',
    file: 'scripts/harness-chat-persistence.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    nodeOptions: '--import $PWD/scripts/harness-chat-persistence.loader-register.mjs',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec env NODE_OPTIONS="--import $PWD/scripts/harness-chat-persistence.loader-register.mjs" tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-chat-persistence.mts',
      'pnpm harness:semantic-title-repository',
    ],
    command:
      'pnpm --filter @offisim/platform exec env NODE_OPTIONS="--import $PWD/scripts/harness-chat-persistence.loader-register.mjs" tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-chat-persistence.mts && pnpm harness:semantic-title-repository',
  },
  {
    id: 'semantic-title-repository',
    file: 'scripts/harness-semantic-title-repository.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-semantic-title-repository.mts',
  },
  {
    id: 'activity-data',
    file: 'scripts/harness-activity-data.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    sharedRunner: true,
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-activity-data.mts',
  },
  {
    id: 'pi-permission',
    file: 'scripts/harness-pi-permission-modes.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-pi-permission-modes.mts',
  },
  {
    id: 'install-core-integrity',
    file: 'scripts/harness-install-core-integrity.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-install-core-integrity.mts',
  },
  {
    id: 'workspace-repo-contract',
    file: 'scripts/harness-workspace-repo-contract.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-workspace-repo-contract.mts',
  },
  {
    id: 'collaboration-repo-contract',
    file: 'scripts/harness-collaboration-repo-contract.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-collaboration-repo-contract.mts',
  },
  {
    id: 'collaboration-profile',
    file: 'scripts/harness-collaboration-profile.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-collaboration-profile.mts',
  },
  {
    id: 'eval-suite',
    file: 'scripts/harness-eval-suite.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-eval-suite.mts',
  },
  {
    id: 'review-fixes',
    file: 'scripts/harness-review-fixes.mjs',
    runner: 'node',
    composite: true,
    steps: [
      'node scripts/harness-review-fixes.mjs',
      'pnpm check:docs-truth',
      'pnpm harness:ai-account-catalog',
      'pnpm harness:ai-account-configuration',
      'pnpm harness:settings-status-coordinator',
      'pnpm harness:ai-account-usage',
      'pnpm harness:market-surface',
      'pnpm harness:personnel-danger-zone',
      'pnpm harness:chrome-stability',
      'pnpm harness:visual-semantics',
    ],
    command:
      'node scripts/harness-review-fixes.mjs && pnpm check:docs-truth && pnpm harness:ai-account-catalog && pnpm harness:ai-account-configuration && pnpm harness:settings-status-coordinator && pnpm harness:ai-account-usage && pnpm harness:market-surface && pnpm harness:personnel-danger-zone && pnpm harness:chrome-stability && pnpm harness:visual-semantics',
  },
  {
    id: 'settings-status-coordinator',
    file: 'scripts/harness-settings-status-coordinator.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-settings-status-coordinator.mts',
  },
  {
    id: 'ai-account-usage',
    file: 'scripts/harness-ai-account-usage.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-ai-account-usage.mts',
  },
  {
    id: 'ai-account-catalog',
    file: 'scripts/harness-ai-account-catalog.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-ai-account-catalog.mjs',
  },
  {
    id: 'ai-account-configuration',
    file: 'scripts/harness-ai-account-configuration.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-ai-account-configuration.mjs',
  },
  {
    id: 'studio-placement',
    file: 'scripts/harness-studio-placement.mjs',
    runner: 'node',
    sharedRunner: true,
    composite: false,
    command: 'node scripts/harness-studio-placement.mjs',
  },
  {
    id: 'motion-tokens',
    file: 'scripts/harness-motion-tokens.mjs',
    runner: 'node',
    sharedRunner: true,
    composite: false,
    command: 'node scripts/harness-motion-tokens.mjs',
  },
  {
    id: 'template-contract',
    file: 'scripts/harness-template-contract.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-template-contract.mts',
  },
  {
    id: 'first-run-onboarding',
    file: 'scripts/harness-first-run-onboarding.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-first-run-onboarding.mts',
  },
  {
    id: 'agent-run-projection',
    file: 'scripts/harness-agent-run-projection.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    sharedRunner: true,
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-agent-run-projection.mts',
  },
  {
    id: 'run-cost-scope',
    file: 'scripts/harness-run-cost-scope.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-run-cost-scope.mts',
      'pnpm harness:staged-compaction',
    ],
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-run-cost-scope.mts && pnpm harness:staged-compaction',
  },
  {
    id: 'staged-compaction',
    file: 'scripts/harness-staged-compaction.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/core',
    composite: true,
    steps: [
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json',
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-staged-compaction.mts',
    ],
    command:
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json && pnpm --filter @offisim/platform exec tsx ../../scripts/harness-staged-compaction.mts',
  },
  {
    id: 'computer-rich-detail',
    file: 'scripts/harness-computer-rich-detail.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-computer-rich-detail.mts',
  },
  {
    id: 'runtime-conformance',
    file: 'scripts/harness-runtime-conformance.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-runtime-conformance.mts',
  },
  {
    id: 'execution-provenance',
    file: 'scripts/harness-execution-provenance.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-execution-provenance.mts',
  },
  {
    id: 'renderer-engine-authority',
    file: 'scripts/harness-renderer-engine-authority.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-renderer-engine-authority.mts',
  },
  {
    id: 'beat-composer',
    file: 'scripts/harness-beat-composer.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    sharedRunner: true,
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-beat-composer.mts',
  },
  {
    id: 'artifact-claim',
    file: 'scripts/harness-artifact-claim.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    sharedRunner: true,
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-artifact-claim.mts',
  },
  {
    id: 'stage-preview-targets',
    file: 'scripts/harness-stage-preview-targets.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-stage-preview-targets.mts',
      'pnpm harness:native-stage-sessions',
    ],
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-stage-preview-targets.mts && pnpm harness:native-stage-sessions',
  },
  {
    id: 'native-stage-sessions',
    file: 'scripts/harness-native-stage-sessions.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-native-stage-sessions.mts',
  },
  {
    id: 'workload-chips',
    file: 'scripts/harness-workload-chips.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    sharedRunner: true,
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-workload-chips.mts',
  },
  {
    id: 'scene-staging',
    file: 'scripts/harness-scene-staging.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-scene-staging.mts',
  },
  {
    id: 'office-projection',
    file: 'scripts/harness-office-projection.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-projection.mts',
  },
  {
    id: 'mission-office-projection',
    file: 'scripts/harness-mission-office-projection.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-office-projection.mts',
  },
  {
    id: 'dramaturgy-modes',
    file: 'scripts/harness-dramaturgy-modes.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    sharedRunner: true,
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-dramaturgy-modes.mts',
  },
  {
    id: 'dramaturgy-stress',
    file: 'scripts/harness-dramaturgy-stress.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-dramaturgy-stress.mts',
  },
  {
    id: 'scene-cue',
    file: 'scripts/harness-scene-cue.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-scene-cue.mts',
  },
  {
    id: 'character-clip-map',
    file: 'scripts/harness-character-clip-map.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-character-clip-map.mts',
  },
  {
    id: 'character-actions-p3',
    file: 'scripts/harness-character-actions-p3.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-character-actions-p3.mts',
  },
  {
    id: 'office-visual-language-p4',
    file: 'scripts/harness-office-visual-language-p4.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-visual-language-p4.mts',
  },
  {
    id: 'office-ambient-p5',
    file: 'scripts/harness-office-ambient-p5.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-ambient-p5.mts',
  },
  {
    id: 'office-companion',
    file: 'scripts/harness-office-companion.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-companion.mts',
  },
  {
    id: 'office-diorama-p6',
    file: 'scripts/harness-office-diorama-p6.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-diorama-p6.mts',
  },
  {
    id: 'office-scene-quality',
    file: 'scripts/harness-office-scene-quality.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-scene-quality.mts',
  },
  {
    id: 'office-seating-p2',
    file: 'scripts/harness-office-seating-p2.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-office-seating-p2.mts',
  },
  {
    id: 'employee-version-on-save',
    file: 'scripts/harness-employee-version-on-save.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-employee-version-on-save.mts',
      'pnpm harness:employee-memory',
      'pnpm harness:employee-seniority',
    ],
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-employee-version-on-save.mts && pnpm harness:employee-memory && pnpm harness:employee-seniority',
  },
  {
    id: 'employee-seniority',
    file: 'scripts/harness-employee-seniority.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-employee-seniority.mts',
  },
  {
    id: 'employee-memory',
    file: 'scripts/harness-employee-memory.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-employee-memory.mts',
  },
  {
    id: 'mission-service',
    file: 'scripts/harness-mission-service.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    sharedRunner: true,
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-service.mts',
  },
  {
    id: 'mission-evaluators',
    file: 'scripts/harness-mission-evaluators.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-evaluators.mts',
  },
  {
    id: 'mission-loop-controller',
    file: 'scripts/harness-mission-loop-controller.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-loop-controller.mts',
      'pnpm harness:budget-nudge',
    ],
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-loop-controller.mts && pnpm harness:budget-nudge',
  },
  {
    id: 'budget-nudge',
    file: 'scripts/harness-budget-nudge.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/core',
    composite: true,
    steps: [
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json',
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-budget-nudge.mts',
    ],
    command:
      'pnpm --filter @offisim/core exec tsc --project tsconfig.json && pnpm --filter @offisim/platform exec tsx ../../scripts/harness-budget-nudge.mts',
  },
  {
    id: 'mission-run-controller',
    file: 'scripts/harness-mission-run-controller.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-mission-run-controller.mts',
  },
  {
    id: 'mission-recovery',
    file: 'scripts/harness-mission-recovery.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mission-recovery.mts',
  },
  {
    id: 'mission-reload',
    file: 'scripts/harness-mission-reload.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-mission-reload.mts',
  },
  {
    id: 'run-recovery',
    file: 'scripts/harness-run-recovery.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-run-recovery.mts',
  },
  {
    id: 'task-board-child-tree',
    file: 'scripts/harness-task-board-child-tree.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-task-board-child-tree.mts',
  },
  {
    id: 'workspace-lease',
    file: 'scripts/harness-workspace-lease.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-workspace-lease.mts',
  },
  {
    id: 'workspace-lease-decisions',
    file: 'scripts/harness-workspace-lease-decisions.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-workspace-lease-decisions.mts',
  },
  {
    id: 'playbook-validation',
    file: 'scripts/harness-playbook-validation.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-playbook-validation.mts',
  },
  {
    id: 'loop-compiler',
    file: 'scripts/harness-loop-compiler.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-loop-compiler.mts',
  },
  {
    id: 'loop-repository',
    file: 'scripts/harness-loop-repository.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: true,
    steps: [
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-loop-repository.mts',
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-token-budget-alerts.mts',
    ],
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-loop-repository.mts && pnpm --filter @offisim/platform exec tsx ../../scripts/harness-token-budget-alerts.mts',
  },
  {
    id: 'loop-mission-adapter',
    file: 'scripts/harness-loop-mission-adapter.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    sharedRunner: true,
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-loop-mission-adapter.mts',
  },
  {
    id: 'loop-graph-projection',
    file: 'scripts/harness-loop-graph-projection.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-loop-graph-projection.mts',
  },
  {
    id: 'loop-office-invocation',
    file: 'scripts/harness-loop-office-invocation.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-loop-office-invocation.mts',
  },
  {
    id: 'loop-authoring-flow',
    file: 'scripts/harness-loop-authoring-flow.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-loop-authoring-flow.mts',
  },
  {
    id: 'market-surface',
    file: 'scripts/harness-market-surface.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-market-surface.mts',
  },
  {
    id: 'personnel-danger-zone',
    file: 'scripts/harness-personnel-danger-zone.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-personnel-danger-zone.mts',
  },
  {
    id: 'chrome-stability',
    file: 'scripts/harness-chrome-stability.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-chrome-stability.mts',
  },
  {
    id: 'visual-semantics',
    file: 'scripts/harness-visual-semantics.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: true,
    steps: [
      'pnpm check:ui-hygiene',
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-visual-semantics.mts',
    ],
    command:
      'pnpm check:ui-hygiene && pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-visual-semantics.mts',
  },
  {
    id: 'prompt-enhance',
    file: 'scripts/harness-prompt-enhance.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-prompt-enhance.mts',
  },
  {
    id: 'pi-collaboration-runtime',
    file: 'scripts/harness-pi-collaboration-runtime.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-pi-collaboration-runtime.mts',
  },
  {
    id: 'connect-chat-flow',
    file: 'scripts/harness-connect-chat-flow.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-connect-chat-flow.mts',
  },
  {
    id: 'pi-agent-host',
    file: 'scripts/harness-pi-agent-host.mjs',
    runner: 'node',
    composite: true,
    steps: [
      'pnpm harness:execution-provenance',
      'node scripts/harness-execution-target-gate.mjs',
      'pnpm harness:agent-run-usage',
      'node scripts/harness-pi-agent-host.mjs',
      'pnpm harness:pi-bash-process-tree',
      'pnpm harness:pi-delegation-integration',
    ],
    command:
      'pnpm harness:execution-provenance && node scripts/harness-execution-target-gate.mjs && pnpm harness:agent-run-usage && node scripts/harness-pi-agent-host.mjs && pnpm harness:pi-bash-process-tree && pnpm harness:pi-delegation-integration',
  },
  {
    id: 'stream-watchdog',
    file: 'scripts/harness-stream-watchdog.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-stream-watchdog.mts',
  },
  {
    id: 'agent-run-usage',
    file: 'scripts/harness-agent-run-usage.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-agent-run-usage.mjs',
  },
  {
    id: 'pi-bash-process-tree',
    file: 'scripts/harness-pi-bash-process-tree.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-pi-bash-process-tree.mjs',
  },
  {
    id: 'pi-delegation-integration',
    file: 'scripts/harness-pi-delegation-integration.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-pi-delegation-integration.mts',
  },
  {
    id: 'pi-loop-until-green',
    file: 'scripts/harness-pi-loop-until-green.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-pi-loop-until-green.mts',
  },
  {
    id: 'mcp-host-channel',
    file: 'scripts/harness-mcp-host-channel.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command: 'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mcp-host-channel.mts',
  },
  {
    id: 'mcp-grant-risk-class',
    file: 'scripts/harness-mcp-grant-risk-class.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    tsconfig: '../../apps/desktop/renderer/tsconfig.json',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx --tsconfig ../../apps/desktop/renderer/tsconfig.json ../../scripts/harness-mcp-grant-risk-class.mts',
  },
  {
    id: 'mcp-bridge-extension',
    file: 'scripts/harness-mcp-bridge-extension.mts',
    runner: 'tsx',
    cwdFilter: '@offisim/platform',
    composite: false,
    command:
      'pnpm --filter @offisim/platform exec tsx ../../scripts/harness-mcp-bridge-extension.mts',
  },
  {
    id: 'mcp-bridge-sdk',
    file: 'scripts/harness-mcp-bridge-sdk.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-mcp-bridge-sdk.mjs',
  },
  {
    id: 'live-agent-run',
    file: 'scripts/harness-live-agent-run.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-live-agent-run.mjs',
  },
  {
    id: 'live-auto-gate',
    file: 'scripts/harness-live-auto-gate.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-live-auto-gate.mjs',
  },
  {
    id: 'live-ask-gate',
    file: 'scripts/harness-live-ask-gate.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-live-ask-gate.mjs',
  },
  {
    id: 'live-mcp-approval-gate',
    file: 'scripts/harness-live-mcp-approval-gate.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-live-mcp-approval-gate.mjs',
  },
  {
    id: 'release-workflow-boundary',
    file: 'scripts/harness-release-workflow-boundary.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-release-workflow-boundary.mjs',
  },
  {
    id: 'deep-link-install',
    file: 'scripts/harness-deep-link-install.mjs',
    runner: 'node',
    composite: false,
    command: 'node scripts/harness-deep-link-install.mjs',
  },
]);

/**
 * Harness ids traversed by pnpm validate, in deterministic order.
 * Nested `pnpm harness:<id>` steps inside composites must not also appear here —
 * that would double-execute the same node in the validate plan.
 */
export const validateHarnessIds = Object.freeze([
  'conversation-deletion',
  'thread-lifecycle-guard',
  'project-workspace',
  'workspace-panel-project-gate',
  'platform-zod-contract',
  'review-fixes',
  'studio-placement',
  'template-contract',
  'first-run-onboarding',
  'agent-run-projection',
  'run-cost-scope',
  'computer-rich-detail',
  'runtime-conformance',
  'stream-watchdog',
  'beat-composer',
  'artifact-claim',
  'stage-preview-targets',
  'workload-chips',
  'scene-staging',
  'office-projection',
  'mission-office-projection',
  'dramaturgy-modes',
  'dramaturgy-stress',
  'scene-cue',
  'character-clip-map',
  'character-actions-p3',
  'office-visual-language-p4',
  'office-ambient-p5',
  'office-companion',
  'office-seating-p2',
  'office-diorama-p6',
  'office-scene-quality',
  'codex-app-server-contract',
  'renderer-engine-authority',
  'pi-agent-host',
  'claude-agent-host',
  'pi-loop-until-green',
  'conversation-run-controller',
  'chat-attachment-roundtrip',
  'workspace-chat-presentation',
  'chat-persistence',
  'activity-data',
  'workspace-repo-contract',
  'collaboration-repo-contract',
  'collaboration-profile',
  'eval-suite',
  'employee-version-on-save',
  'mission-service',
  'mission-evaluators',
  'mission-loop-controller',
  'mission-run-controller',
  'mission-recovery',
  'mission-reload',
  'run-recovery',
  'task-board-child-tree',
  'workspace-lease',
  'workspace-lease-decisions',
  'playbook-validation',
  'loop-compiler',
  'loop-repository',
  'loop-mission-adapter',
  'loop-graph-projection',
  'loop-office-invocation',
  'loop-authoring-flow',
  'prompt-enhance',
  'pi-collaboration-runtime',
  'connect-chat-flow',
  'mcp-host-channel',
  'mcp-grant-risk-class',
  'mcp-bridge-extension',
  'mcp-bridge-sdk',
  'pi-permission',
  'release-workflow-boundary',
  'deep-link-install',
]);

/**
 * Existing tooling-only private-source imports. The cross-package guard reads
 * this manifest-owned list so harness file ownership has one source of truth.
 * Entries must match real module imports (AST), not URL/fs path strings.
 */
export const harnessSourceImports = Object.freeze([
  'scripts/check-local-schema-drift.mts::../packages/db-local/src/schema.js',
  'scripts/harness-registry-client-security.mts::../packages/registry-client/src/index.ts',
  'scripts/pi-agent-permission-modes.mts::../packages/core/src/tools/builtin/shell-command-classifier.ts',
  'scripts/harness-web-fetch-security.mts::../packages/core/src/tools/builtin/web-fetch-tool.js',
  'scripts/harness-git-source-security.mts::../packages/core/src/skills/skill-source-resolvers/git.ts',
  'scripts/harness-git-source-security.mts::../packages/core/src/skills/skill-source-resolvers/upload.ts',
  'scripts/harness-doc-engine-csv-security.mts::../packages/doc-engine/src/export.js',
  'scripts/harness-doc-engine-xlsx-limits.mts::../packages/doc-engine/src/import/index.js',
  'scripts/harness-web-search-security.mts::../packages/core/src/tools/builtin/web-search-tool.ts',
  'scripts/harness-conversation-run-controller.mts::../packages/core/src/browser.js',
  'scripts/harness-workspace-repo-contract.mts::../packages/core/src/runtime/repos/workspace/drizzle.js',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/integrity-checker.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/package-builder.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/manifest-loader.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/hash.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/materializer.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/rollback.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/types.ts',
  'scripts/harness-template-contract.mts::../packages/core/src/browser.js',
  'scripts/harness-template-contract.mts::../packages/shared-types/src/index.js',
  'scripts/harness-computer-rich-detail.mts::../packages/shared-types/src/index.js',
  'scripts/harness-employee-version-on-save.mts::../packages/core/src/browser.js',
  'scripts/harness-agent-run-projection.mts::../packages/shared-types/src/index.js',
  'scripts/harness-beat-composer.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-scene-staging.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-office-projection.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-mission-office-projection.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-mcp-bridge-extension.mts::../packages/shared-types/src/index.js',
  'scripts/harness-dramaturgy-modes.mts::../packages/shared-types/src/index.js',
  'scripts/harness-dramaturgy-modes.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-dramaturgy-stress.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-scene-cue.mts::../packages/shared-types/src/index.js',
  'scripts/harness-scene-cue.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-office-ambient-p5.mts::../packages/dramaturgy/src/index.js',
  'scripts/harness-chat-persistence.mts::../packages/core/src/browser.js',
  'scripts/harness-runtime-conformance.mts::../packages/shared-types/src/index.js',
  'scripts/harness-loop-graph-projection.mts::../packages/shared-types/src/index.ts',
  'scripts/harness-mission-service.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-service.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-evaluators.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-mission-evaluators.mts::../packages/core/src/runtime/mission/evaluators/types.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/mission-loop-controller.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/evaluators/types.ts',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/browser.js',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/runtime/repos/deliverables/memory.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/safe-boundary.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/compatibility-hash.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/reconciliation.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/retry-safety.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/resume-plan.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/types.ts',
  'scripts/harness-workspace-lease.mts::../packages/core/src/runtime/mission/workspace/lease-manager.ts',
  'scripts/harness-pi-delegation-integration.mts::../packages/core/src/runtime/mission/workspace/lease-manager.ts',
  'scripts/harness-pi-delegation-integration.mts::../packages/core/src/runtime/mission/workspace/types.ts',
  'scripts/harness-run-recovery.mts::../packages/core/src/runtime/repositories.ts',
  'scripts/harness-run-recovery.mts::../packages/core/src/runtime/repos/agent-runs/memory.ts',
  'scripts/harness-mission-reload.mts::../packages/core/src/runtime/repos/agent-runs/memory.ts',
  'scripts/harness-mission-reload.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-reload.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-reload.mts::../packages/core/src/runtime/repositories.ts',
  'scripts/harness-playbook-validation.mts::../packages/shared-types/src/index.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/playbook/validate.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/playbook/materialize.ts',
  'scripts/harness-loop-compiler.mts::../packages/shared-types/src/loops/ir.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/index.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/validate.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/loops/loop-service.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/shared-types/src/loops/index.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/mission-adapter.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/index.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-collaboration-repo-contract.mts::../packages/core/src/runtime/repositories.js',
  'scripts/harness-collaboration-repo-contract.mts::../packages/core/src/runtime/repos/collaboration/drizzle.js',
  'scripts/harness-collaboration-repo-contract.mts::../packages/core/src/runtime/collaboration/collaboration-service.js',
  'scripts/harness-pi-collaboration-runtime.mts::../packages/core/src/runtime/repos/collaboration/memory.js',
  'scripts/harness-pi-collaboration-runtime.mts::../packages/core/src/runtime/collaboration/collaboration-service.js',
  'scripts/harness-pi-collaboration-runtime.mts::../packages/shared-types/src/index.js',
  'scripts/harness-connect-chat-flow.mts::../packages/core/src/runtime/collaboration/collaboration-service.js',
  'scripts/harness-connect-chat-flow.mts::../packages/core/src/runtime/repos/collaboration/drizzle.js',
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/browser.ts',
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/browser.ts',
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/loops/types.ts',
]);

const HARNESS_STEP_REF_RE = /\bpnpm\s+harness:([\w-]+)/g;

/**
 * Nested harness ids invoked from a composite entry's ordered steps.
 * @param {HarnessManifestEntry} entry
 * @returns {string[]}
 */
export function nestedHarnessIdsFromEntry(entry) {
  if (!entry.composite || !Array.isArray(entry.steps)) return [];
  /** @type {string[]} */
  const ids = [];
  for (const step of entry.steps) {
    HARNESS_STEP_REF_RE.lastIndex = 0;
    for (const match of step.matchAll(HARNESS_STEP_REF_RE)) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * Build the deterministic validate execution plan and reject integrity faults:
 * duplicate harness ids, duplicate validate roots, unknown refs, cycles, and
 * legacy/composite double execution of the same node.
 *
 * @param {{
 *   manifest?: readonly HarnessManifestEntry[],
 *   validateIds?: readonly string[],
 * }} [options]
 */
export function buildHarnessExecutionPlan(options = {}) {
  const manifest = options.manifest ?? harnessManifest;
  const validateIds = options.validateIds ?? validateHarnessIds;
  /** @type {string[]} */
  const errors = [];

  /** @type {Map<string, HarnessManifestEntry>} */
  const byId = new Map();
  for (const entry of manifest) {
    if (byId.has(entry.id)) {
      errors.push(`duplicate harness id: ${entry.id}`);
      continue;
    }
    byId.set(entry.id, entry);
  }

  /** @type {Set<string>} */
  const seenRoots = new Set();
  for (const id of validateIds) {
    if (seenRoots.has(id)) {
      errors.push(`duplicate validate harness id: ${id}`);
      continue;
    }
    seenRoots.add(id);
    if (!byId.has(id)) {
      errors.push(`unknown validate harness id: ${id}`);
    }
  }

  /** @type {Map<string, string[]>} */
  const edges = new Map();
  for (const entry of byId.values()) {
    const nested = nestedHarnessIdsFromEntry(entry);
    edges.set(entry.id, nested);
    for (const child of nested) {
      if (!byId.has(child)) {
        errors.push(`unknown nested harness id '${child}' from composite '${entry.id}'`);
      }
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  /** @type {Map<string, number>} */
  const color = new Map([...byId.keys()].map((id) => [id, WHITE]));
  /** @type {string[]} */
  const stack = [];

  function dfs(id) {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!byId.has(next)) continue;
      const state = color.get(next);
      if (state === GRAY) {
        errors.push(`cyclic harness execution: ${[...stack, next].join(' -> ')}`);
        continue;
      }
      if (state === WHITE) dfs(next);
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const id of byId.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }

  function failIfNeeded() {
    if (errors.length === 0) return;
    const error = new Error(`harness manifest integrity failed:\n- ${errors.join('\n- ')}`);
    error.errors = errors;
    throw error;
  }

  // Structural faults (dups/unknown/cycles) must fail before expansion so a
  // cyclic composite cannot blow the stack while collecting execution nodes.
  failIfNeeded();

  /** @type {Map<string, string[]>} */
  const executedBy = new Map();

  function noteExecution(id, reason) {
    const reasons = executedBy.get(id) ?? [];
    reasons.push(reason);
    executedBy.set(id, reasons);
  }

  function collectNested(rootId, viaPath) {
    for (const child of edges.get(rootId) ?? []) {
      noteExecution(child, `nested via ${[...viaPath, rootId].join(' -> ')}`);
      collectNested(child, [...viaPath, rootId]);
    }
  }

  /** @type {string[]} */
  const plan = [];
  for (const rootId of validateIds) {
    if (!byId.has(rootId)) continue;
    noteExecution(rootId, 'validate root');
    plan.push(rootId);
    collectNested(rootId, []);
  }

  for (const [id, reasons] of executedBy) {
    if (reasons.length > 1) {
      errors.push(
        `duplicate execution node '${id}': ${reasons.join('; ')} (legacy/composite double execution)`,
      );
    }
  }

  failIfNeeded();

  return Object.freeze({
    plan: Object.freeze([...plan]),
    executedIds: Object.freeze([...executedBy.keys()]),
    byId,
  });
}

/**
 * Fail-closed integrity checker for the live harness catalog.
 * @param {{
 *   manifest?: readonly HarnessManifestEntry[],
 *   validateIds?: readonly string[],
 * }} [options]
 */
export function assertHarnessManifestIntegrity(options = {}) {
  return buildHarnessExecutionPlan(options);
}

const livePlan = assertHarnessManifestIntegrity();
export const harnessById = livePlan.byId;
export const harnessExecutionPlan = livePlan.plan;

function runHarnessManifestSelfTests() {
  /** @type {string[]} */
  const failures = [];

  function expectThrow(label, fn, pattern) {
    try {
      fn();
      failures.push(`${label}: expected throw`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!pattern.test(message)) {
        failures.push(`${label}: throw did not match ${pattern}: ${message}`);
      }
    }
  }

  /** @type {HarnessManifestEntry[]} */
  const base = [
    {
      id: 'leaf-a',
      file: 'scripts/a.mjs',
      runner: 'node',
      composite: false,
      command: 'node scripts/a.mjs',
    },
    {
      id: 'leaf-b',
      file: 'scripts/b.mjs',
      runner: 'node',
      composite: false,
      command: 'node scripts/b.mjs',
    },
    {
      id: 'bundle',
      file: 'scripts/bundle.mjs',
      runner: 'node',
      composite: true,
      steps: ['pnpm harness:leaf-a', 'node scripts/bundle.mjs'],
      command: 'pnpm harness:leaf-a && node scripts/bundle.mjs',
    },
  ];

  const ok = buildHarnessExecutionPlan({
    manifest: base,
    validateIds: ['bundle', 'leaf-b'],
  });
  if (ok.plan.join(',') !== 'bundle,leaf-b') {
    failures.push(`unexpected plan: ${ok.plan.join(',')}`);
  }
  if (!ok.executedIds.includes('leaf-a') || !ok.executedIds.includes('bundle')) {
    failures.push('expanded plan must include nested leaf-a exactly once');
  }

  expectThrow(
    'duplicate harness id',
    () =>
      buildHarnessExecutionPlan({
        manifest: [...base, { ...base[0], command: 'node scripts/a2.mjs' }],
        validateIds: ['leaf-b'],
      }),
    /duplicate harness id: leaf-a/,
  );

  expectThrow(
    'duplicate validate id',
    () =>
      buildHarnessExecutionPlan({
        manifest: base,
        validateIds: ['leaf-b', 'leaf-b'],
      }),
    /duplicate validate harness id: leaf-b/,
  );

  expectThrow(
    'legacy/composite double execution',
    () =>
      buildHarnessExecutionPlan({
        manifest: base,
        validateIds: ['leaf-a', 'bundle'],
      }),
    /duplicate execution node 'leaf-a'/,
  );

  expectThrow(
    'cycle',
    () =>
      buildHarnessExecutionPlan({
        manifest: [
          {
            id: 'one',
            file: 'scripts/one.mjs',
            runner: 'node',
            composite: true,
            steps: ['pnpm harness:two'],
            command: 'pnpm harness:two',
          },
          {
            id: 'two',
            file: 'scripts/two.mjs',
            runner: 'node',
            composite: true,
            steps: ['pnpm harness:one'],
            command: 'pnpm harness:one',
          },
        ],
        validateIds: ['one'],
      }),
    /cyclic harness execution/,
  );

  expectThrow(
    'unknown nested',
    () =>
      buildHarnessExecutionPlan({
        manifest: [
          {
            id: 'parent',
            file: 'scripts/parent.mjs',
            runner: 'node',
            composite: true,
            steps: ['pnpm harness:missing-child'],
            command: 'pnpm harness:missing-child',
          },
        ],
        validateIds: ['parent'],
      }),
    /unknown nested harness id 'missing-child'/,
  );

  if (failures.length > 0) {
    console.error('[harness-manifest] self-test failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[harness-manifest] integrity ok (${harnessManifest.length} harnesses, ${harnessExecutionPlan.length} validate roots, self-test ok)`,
  );
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHarnessManifestSelfTests();
}
