import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runToolRound } from '../packages/core/src/agents/employee-tool-round.ts';
import { handleSkillInstallTool } from '../packages/core/src/agents/skill-install-tools.ts';
import { InMemoryEventBus } from '../packages/core/src/events/event-bus.ts';
import { createMemoryInstallRepositories } from '../packages/core/src/runtime/memory-install-repos.ts';
import { createMemoryRepositories } from '../packages/core/src/runtime/memory-repositories.ts';
import { RunConversationState } from '../packages/core/src/runtime/run-conversation-state.ts';
import type { RuntimeContext } from '../packages/core/src/runtime/runtime-context.ts';
import { InteractionService } from '../packages/core/src/services/interaction-service.ts';
import { SkillInstallCommitter } from '../packages/core/src/skills/skill-install-committer.ts';
import { SkillLoader } from '../packages/core/src/skills/skill-loader.ts';
import type { VirtualTree } from '../packages/core/src/skills/skill-source-resolvers/types.ts';
import { SkillStagingManager } from '../packages/core/src/skills/skill-staging.ts';
import type { VaultFileSystem } from '../packages/core/src/vault/fs.ts';
import { zipSync } from '../packages/install-core/node_modules/fflate/esm/index.mjs';
import {
  InstallService,
  InstallServiceError,
} from '../packages/install-core/src/install-service.ts';
import type {
  InstallEventEmitter,
  InstallPlan,
  InstallRepositories,
  NewEmployee,
} from '../packages/install-core/src/types.ts';

const companyId = 'company-install-harness';

function plan(packageId = 'pkg.harness.employee', version = '1.0.0'): InstallPlan {
  return {
    manifest: {
      spec_version: '1.0',
      package: {
        id: packageId,
        kind: 'employee',
        version,
        title: 'Harness Employee',
        summary: 'Install materialization harness package',
        license: 'UNLICENSED',
      },
      compatibility: {
        runtime_range: '>=1.0.0',
        schema_version: '1.0',
        supported_environments: ['desktop'],
      },
      requirements: {
        required_capabilities: [],
        required_mcps: [],
      },
      permissions: {
        risk_class: 'logic_asset',
        declares_secrets: false,
        filesystem_scope: 'none',
        network_scope: 'none',
      },
      assets: [
        {
          asset_id: 'employee_harness',
          kind: 'employee',
          path: 'employee.json',
          default_enabled: true,
        },
      ],
      integrity: {
        package_sha256: '0'.repeat(64),
      },
    },
    compatibility: { compatible: true, errors: [], warnings: [] },
    bindings: [],
    needsConfirmation: false,
    confirmationReasons: [],
    packageHash: '1'.repeat(64),
    manifestHash: '2'.repeat(64),
  };
}

const events: InstallEventEmitter = {
  emitInstallState() {},
  emitBindingState() {},
  emitMarketListingInstalled() {},
};

function createEmployeesRepo() {
  const employees = new Map<string, NewEmployee & { employee_id: string }>();
  return {
    async create(emp: NewEmployee): Promise<{ employee_id: string }> {
      const employeeId = emp.employee_id ?? `emp-${employees.size + 1}`;
      employees.set(employeeId, { ...emp, employee_id: employeeId });
      return { employee_id: employeeId };
    },
    async delete(id: string): Promise<void> {
      employees.delete(id);
    },
  };
}

function createService() {
  const base = createMemoryInstallRepositories();
  const repos: InstallRepositories = {
    ...base,
    employees: createEmployeesRepo(),
  };
  const service = new InstallService({
    repos,
    events,
    companyId,
    environment: {
      runtimeVersion: '1.0.0',
      environment: 'desktop',
      schemaVersion: '2026-03',
    },
  });
  return { service, repos };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function registryInstallArchive(): { archiveBytes: Uint8Array; sha256: string } {
  const skillBytes = new TextEncoder().encode('skill');
  const readmeBytes = new TextEncoder().encode('# Registry Hash Harness\n');
  const manifest = {
    spec_version: '1.0.0',
    package: {
      id: 'offisim.skill.registry-hash-harness',
      kind: 'skill',
      version: '0.1.0',
      title: 'Registry Hash Harness',
      summary: 'Install hash verification harness package',
      license: 'MIT',
    },
    compatibility: {
      runtime_range: '>=1.0 <2.0',
      schema_version: '2026-03',
      supported_environments: ['desktop'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: 'data_asset',
      declares_secrets: false,
      filesystem_scope: 'workspace',
      network_scope: 'none',
    },
    assets: [
      {
        asset_id: 'registry-hash-harness',
        kind: 'skill',
        path: 'assets/skills/registry-hash-harness/SKILL.md',
        default_enabled: true,
      },
    ],
    distribution: {
      mirror_policy: 'registry_only',
    },
    integrity: {
      package_sha256: '0'.repeat(64),
      files: [
        {
          path: 'assets/skills/registry-hash-harness/SKILL.md',
          sha256: hashBytes(skillBytes),
        },
        {
          path: 'README.md',
          sha256: hashBytes(readmeBytes),
        },
      ],
    },
    previews: {
      readme_path: 'README.md',
    },
  };
  const archiveBytes = zipSync({
    'assets/skills/registry-hash-harness/SKILL.md': skillBytes,
    'README.md': readmeBytes,
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });
  return { archiveBytes, sha256: hashBytes(archiveBytes) };
}

async function seedReadyTransaction(
  service: InstallService,
  repos: InstallRepositories,
  installTxnId: string,
  installPlan: InstallPlan,
  state: 'ready_to_install' | 'materializing' = 'ready_to_install',
) {
  await repos.installTransactions.create({
    install_txn_id: installTxnId,
    company_id: companyId,
    source_type: 'registry',
    source_ref: 'listing-harness',
    target_package_id: installPlan.manifest.package.id,
    target_version: installPlan.manifest.package.version,
    idempotency_key: null,
    state,
    error_code: null,
    error_detail: null,
    descriptor_json: JSON.stringify({
      listing_id: 'listing-harness',
      package_version_id: 'package-version-harness',
    }),
    actor_type: 'user',
    started_at: new Date().toISOString(),
  });
  (service as unknown as { planCache: Map<string, InstallPlan> }).planCache.set(
    installTxnId,
    installPlan,
  );
}

async function assertRegistryImportIdempotencyKeyReplaysActiveTransaction() {
  const { service, repos } = createService();
  const installPlan = plan('pkg.harness.idempotency-key', '3.0.0');
  const archiveBytes = new TextEncoder().encode('not used when createInstallPlan is bypassed');
  await repos.installTransactions.create({
    install_txn_id: 'txn-import-idempotency',
    company_id: companyId,
    source_type: 'registry',
    source_ref: 'listing-harness',
    target_package_id: installPlan.manifest.package.id,
    target_version: installPlan.manifest.package.version,
    idempotency_key: 'registry:package-version-harness',
    state: 'ready_to_install',
    error_code: null,
    error_detail: null,
    descriptor_json: JSON.stringify({
      listing_id: 'listing-harness',
      package_version_id: 'package-version-harness',
    }),
    actor_type: 'user',
    started_at: new Date().toISOString(),
  });
  (service as unknown as { planCache: Map<string, InstallPlan> }).planCache.set(
    'txn-import-idempotency',
    installPlan,
  );

  const replay = await service.importFile(archiveBytes, {
    sourceType: 'registry',
    sourceRef: 'listing-harness',
    targetPackageId: installPlan.manifest.package.id,
    targetVersion: installPlan.manifest.package.version,
    descriptor: {
      listing_id: 'listing-harness',
      package_version_id: 'package-version-harness',
    },
  });

  assert.equal(replay.installTxnId, 'txn-import-idempotency');
  assert.equal(replay.plan, installPlan);
  assert.equal(repos.installTransactions.snapshot().length, 1);
}

async function assertRetryAfterFailedIdempotencyKeyCreatesNewAttempt() {
  const { service, repos } = createService();
  await repos.installTransactions.create({
    install_txn_id: 'txn-failed-attempt',
    company_id: companyId,
    source_type: 'registry',
    source_ref: 'listing-harness',
    target_package_id: 'pkg.harness.retry',
    target_version: '4.0.0',
    idempotency_key: 'registry:package-version-retry',
    state: 'failed',
    error_code: 'materialize_failed',
    error_detail: 'previous failure',
    descriptor_json: JSON.stringify({
      listing_id: 'listing-harness',
      package_version_id: 'package-version-retry',
    }),
    actor_type: 'user',
    started_at: new Date().toISOString(),
  });

  const result = await service.importFile(new TextEncoder().encode('invalid retry archive'), {
    sourceType: 'registry',
    sourceRef: 'listing-harness',
    targetPackageId: 'pkg.harness.retry',
    targetVersion: '4.0.0',
    descriptor: {
      listing_id: 'listing-harness',
      package_version_id: 'package-version-retry',
    },
  });

  assert.notEqual(result.installTxnId, 'txn-failed-attempt');
  assert.equal(repos.installTransactions.snapshot().length, 2);
}

async function assertStaleMaterializingIdempotencyKeyCreatesNewAttempt() {
  const { service, repos } = createService();
  await repos.installTransactions.create({
    install_txn_id: 'txn-stale-materializing',
    company_id: companyId,
    source_type: 'registry',
    source_ref: 'listing-harness',
    target_package_id: 'pkg.harness.stale-materializing',
    target_version: '5.0.0',
    idempotency_key: 'registry:package-version-stale-materializing',
    state: 'materializing',
    error_code: null,
    error_detail: null,
    descriptor_json: JSON.stringify({
      listing_id: 'listing-harness',
      package_version_id: 'package-version-stale-materializing',
    }),
    actor_type: 'user',
    started_at: new Date().toISOString(),
  });

  const result = await service.importFile(new TextEncoder().encode('invalid retry archive'), {
    sourceType: 'registry',
    sourceRef: 'listing-harness',
    targetPackageId: 'pkg.harness.stale-materializing',
    targetVersion: '5.0.0',
    descriptor: {
      listing_id: 'listing-harness',
      package_version_id: 'package-version-stale-materializing',
    },
  });

  assert.notEqual(result.installTxnId, 'txn-stale-materializing');
  const stale = await repos.installTransactions.findById('txn-stale-materializing');
  assert.equal(stale?.state, 'failed');
  assert.equal(stale?.error_code, 'stale_materializing');
  assert.equal(repos.installTransactions.snapshot().length, 2);
}

async function assertRegistryInstallHashMismatchFailsBeforeMaterialization() {
  const { service, repos } = createService();
  const { archiveBytes, sha256 } = registryInstallArchive();
  const expectedArtifactSha256 = sha256 === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
  const result = await service.importFile(archiveBytes, {
    sourceType: 'registry',
    sourceRef: 'listing-registry-hash',
    targetPackageId: 'offisim.skill.registry-hash-harness',
    targetVersion: '0.1.0',
    descriptor: {
      listing_id: 'listing-registry-hash',
      package_version_id: 'package-version-registry-hash',
    },
    expectedArtifactSha256,
  });

  assert.equal(result.plan, undefined);
  assert.match(result.error ?? '', /Integrity check failed/u);
  const txn = await repos.installTransactions.findById(result.installTxnId);
  assert.equal(txn?.state, 'failed');
  assert.equal(txn?.error_code, 'integrity_mismatch');
  assert.equal(repos.installedPackages.snapshot().length, 0);
}

function assertReleaseDesktopUsesNativeInstallTransaction() {
  const tauriRuntime = readFileSync(
    new URL('../apps/web/src/lib/tauri-runtime.ts', import.meta.url),
    'utf8',
  );
  const tauriDrizzle = readFileSync(
    new URL('../apps/web/src/lib/tauri-drizzle.ts', import.meta.url),
    'utf8',
  );
  const localDb = readFileSync(
    new URL('../apps/desktop/src-tauri/src/local_db.rs', import.meta.url),
    'utf8',
  );
  assert.match(tauriRuntime, /asyncTransact:\s*withTauriSqlTransaction/u);
  assert.match(tauriDrizzle, /local_db_execute_transaction/u);
  assert.match(localDb, /local_db_execute_transaction/u);
}

function assertMcpStdioPolicyCoverage() {
  const registryStore = readFileSync(
    new URL('../apps/desktop/src-tauri/src/mcp_bridge/registry_store.rs', import.meta.url),
    'utf8',
  );
  const commands = readFileSync(
    new URL('../apps/desktop/src-tauri/src/mcp_bridge/commands.rs', import.meta.url),
    'utf8',
  );
  const permissionEngine = readFileSync(
    new URL('../packages/core/src/permissions/tool-permission-engine.ts', import.meta.url),
    'utf8',
  );
  assert.match(registryStore, /marketplace-detail/u);
  assert.match(registryStore, /installed-asset stdio MCP registration requires source package/u);
  assert.match(commands, /mcp_stdio_started/u);
  assert.match(commands, /mcp_tool_called/u);
  assert.match(commands, /source package metadata did not match/u);
  assert.match(permissionEngine, /default:unknown_mcp/u);
  assert.match(permissionEngine, /explicit approval is required/u);
}

function assertMarketplaceDoesNotInvokeMcpRegistration() {
  const marketplaceDir = new URL(
    '../packages/ui-office/src/components/marketplace',
    import.meta.url,
  );
  const forbidden = ['registerDesktopMcpServer', 'mcp_register_server', 'mcp_connect_registered'];
  for (const file of walkFiles(marketplaceDir.pathname)) {
    const source = readFileSync(file, 'utf8');
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${file} must not directly invoke ${token}`);
    }
  }
}

function walkFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...walkFiles(path));
    else if (/\.(ts|tsx)$/u.test(entry)) result.push(path);
  }
  return result;
}

function createMemoryVaultFs(): VaultFileSystem & { snapshot(): Map<string, string> } {
  const files = new Map<string, string>();
  const normalize = (path: string) => path.replace(/^\/+/u, '').replace(/\/+/gu, '/');
  return {
    root: 'memory-vault',
    async readFile(path) {
      const value = files.get(normalize(path));
      if (value === undefined) throw new Error(`missing vault file: ${path}`);
      return value;
    },
    async writeFile(path, content) {
      files.set(normalize(path), content);
    },
    async listDir(path) {
      const prefix = normalize(path).replace(/\/?$/u, '/');
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const [name] = rest.split('/');
        if (name) names.add(name);
      }
      return [...names].sort();
    },
    async stat(path) {
      const value = files.get(normalize(path));
      return value === undefined
        ? null
        : { mtimeMs: 1, size: new TextEncoder().encode(value).length };
    },
    async remove(path) {
      files.delete(normalize(path));
    },
    async mkdir() {},
    async exists(path) {
      const normalized = normalize(path);
      if (files.has(normalized)) return true;
      const prefix = normalized.replace(/\/?$/u, '/');
      return [...files.keys()].some((key) => key.startsWith(prefix));
    },
    snapshot() {
      return new Map(files);
    },
  };
}

async function assertGitSkillInstallStagesAndMaterializesAfterConfirmation() {
  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories(undefined, undefined, eventBus);
  const threadId = 'thread-git-skill-install';
  const gitCompanyId = 'company-git-skill-install';
  const projectIdFixture = 'project-git-skill-install';
  const employeeId = 'emp-git-skill-install';
  await repos.companies.create({
    company_id: gitCompanyId,
    name: 'Git Skill Harness Co',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  });
  await repos.employees.create({
    employee_id: employeeId,
    company_id: gitCompanyId,
    source_asset_id: 'asset-git-skill-install',
    source_package_id: 'pkg-git-skill-install',
    name: 'Sam',
    role_slug: 'engineer',
  });

  const vaultFs = createMemoryVaultFs();
  const skillLoader = new SkillLoader({
    skills: repos.skills,
    employees: repos.employees,
    fs: vaultFs,
  });
  const noInterval = (() => 0) as unknown as typeof setInterval;
  const staging = new SkillStagingManager({
    now: () => 1_704_067_200_000,
    idFactory: () => 'stg-git-skill-install',
    setInterval: noInterval,
    clearInterval: (() => undefined) as typeof clearInterval,
  });
  const committer = new SkillInstallCommitter({
    companyId: gitCompanyId,
    threadId,
    skillLoader,
    staging,
    eventBus,
  });
  const interactionService = new InteractionService({
    eventBus,
    companyId: gitCompanyId,
    threadId,
    defaultMode: 'human_in_loop',
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
    skillInstallConfirmHandler: committer,
  });

  const tmpPath = '/bound/project/.offisim/tmp/offisim-skill-harness';
  const tree: VirtualTree = {
    files: [
      {
        path: 'smoke-skill/SKILL.md',
        content: new TextEncoder().encode(
          [
            '---',
            'name: smoke-skill',
            'description: Git sourced smoke skill',
            'allowedTools:',
            '  - read_file',
            '---',
            '# Smoke Skill',
            'Use this skill to verify git source installation.',
          ].join('\n'),
        ),
      },
    ],
  };
  let cloneArgs: unknown = null;
  let cleanupPath: string | null = null;
  const runtimeCtx = {
    repos,
    companyId: gitCompanyId,
    threadId,
    determinism: {
      nowMs: () => 1_704_067_200_000,
      nowIso: () => '2024-01-01T00:00:00.000Z',
      id: (prefix: string) => `${prefix}-git-skill-install`,
      uuid: () => '00000000-0000-4000-8000-000000000001',
    },
    skillInstallEnvironment: {
      runtime: 'desktop',
      httpFetch: async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      clone: {
        async clone(args: { url: string; ref?: string }) {
          cloneArgs = args;
          return { tmpPath };
        },
      },
      gitFs: {
        async readTree(localPath: string) {
          assert.equal(localPath, tmpPath);
          return tree;
        },
        async cleanup(localPath: string) {
          cleanupPath = localPath;
        },
      },
      async forProject(projectId: string | null | undefined) {
        assert.equal(projectId, projectIdFixture);
        return this;
      },
    },
    skillStagingManager: staging,
    interactionService,
    conversationState: new RunConversationState(),
  } as unknown as RuntimeContext;

  const staged = JSON.parse(
    await handleSkillInstallTool(
      'install_skill_from_git',
      {
        url: '/tmp/offisim-git-skill-source',
        subpath: 'smoke-skill',
        scope: 'employee',
        targetEmployeeId: employeeId,
      },
      runtimeCtx,
      employeeId,
      'harness/model',
      projectIdFixture,
    ),
  ) as { status?: string; interactionId?: string; stagingRef?: string };

  assert.deepEqual(cloneArgs, { url: '/tmp/offisim-git-skill-source' });
  assert.equal(staged.status, 'pending-confirm');
  assert.ok(staged.interactionId);
  assert.equal(staged.stagingRef, 'stg-git-skill-install');
  const pending = interactionService.getPending();
  assert.equal(pending?.kind, 'skill_install_confirm');
  assert.equal(pending?.context?.type, 'skill_install_confirm');
  assert.equal(pending?.context?.sourceKind, 'git');
  assert.equal(pending?.context?.resolvedEmployeeId, employeeId);

  const resolved = await interactionService.resolve({
    interactionId: staged.interactionId,
    selectedOptionId: 'confirm',
    respondedAt: 1_704_067_200_001,
  });
  assert.equal(resolved?.skillInstallOutcome?.kind, 'installed');
  assert.equal(cleanupPath, tmpPath);

  const installed = await repos.skills.listByEmployee(gitCompanyId, employeeId);
  assert.equal(installed.length, 1);
  assert.equal(installed[0]?.name, 'smoke-skill');
  assert.equal(installed[0]?.source_kind, 'installed');
  assert.equal(installed[0]?.source_ref, 'git:/tmp/offisim-git-skill-source#smoke-skill');
  const writtenPaths = [...vaultFs.snapshot().keys()];
  assert.equal(writtenPaths.length, 1);
  assert.ok(writtenPaths[0]?.endsWith('/SKILL.md'));
  staging.dispose();
}

async function assertSkillInstallToolRoundStopsForConfirmation() {
  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories(undefined, undefined, eventBus);
  const threadId = 'thread-git-skill-install-round';
  const gitCompanyId = 'company-git-skill-install-round';
  const projectIdFixture = 'project-git-skill-install-round';
  const employeeId = 'emp-git-skill-install-round';
  await repos.companies.create({
    company_id: gitCompanyId,
    name: 'Git Skill Round Harness Co',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  });
  await repos.employees.create({
    employee_id: employeeId,
    company_id: gitCompanyId,
    source_asset_id: 'asset-git-skill-install-round',
    source_package_id: 'pkg-git-skill-install-round',
    name: 'Round Sam',
    role_slug: 'engineer',
  });

  const vaultFs = createMemoryVaultFs();
  const skillLoader = new SkillLoader({
    skills: repos.skills,
    employees: repos.employees,
    fs: vaultFs,
  });
  const noInterval = (() => 0) as unknown as typeof setInterval;
  const staging = new SkillStagingManager({
    now: () => 1_704_067_200_000,
    idFactory: () => 'stg-git-skill-install-round',
    setInterval: noInterval,
    clearInterval: (() => undefined) as typeof clearInterval,
  });
  const committer = new SkillInstallCommitter({
    companyId: gitCompanyId,
    threadId,
    skillLoader,
    staging,
    eventBus,
  });
  const interactionService = new InteractionService({
    eventBus,
    companyId: gitCompanyId,
    threadId,
    defaultMode: 'human_in_loop',
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
    skillInstallConfirmHandler: committer,
  });

  const tmpPath = '/bound/project/.offisim/tmp/offisim-skill-round';
  const tree: VirtualTree = {
    files: [
      {
        path: 'smoke-skill-round/SKILL.md',
        content: new TextEncoder().encode(
          [
            '---',
            'name: smoke-skill-round',
            'description: Git sourced smoke skill round',
            '---',
            '# Smoke Skill Round',
            'Use this skill to verify pending confirmation halts the tool loop.',
          ].join('\n'),
        ),
      },
    ],
  };
  let cloneArgs: unknown = null;
  const runtimeCtx = {
    repos,
    companyId: gitCompanyId,
    threadId,
    determinism: {
      nowMs: () => 1_704_067_200_000,
      nowIso: () => '2024-01-01T00:00:00.000Z',
      id: (prefix: string) => `${prefix}-git-skill-install-round`,
      uuid: () => '00000000-0000-4000-8000-000000000002',
    },
    skillInstallEnvironment: {
      runtime: 'desktop',
      httpFetch: async () => ({
        ok: false,
        status: 404,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      clone: {
        async clone(args: { url: string; ref?: string }) {
          cloneArgs = args;
          return { tmpPath };
        },
      },
      gitFs: {
        async readTree(localPath: string) {
          assert.equal(localPath, tmpPath);
          return tree;
        },
        async cleanup() {},
      },
      async forProject(projectId: string | null | undefined) {
        assert.equal(projectId, projectIdFixture);
        return this;
      },
    },
    skillStagingManager: staging,
    interactionService,
    conversationState: new RunConversationState(),
  } as unknown as RuntimeContext;

  const outcome = await runToolRound({
    llmResponse: {
      content: '',
      toolCalls: [
        {
          id: 'forced-tool-round',
          name: 'install_skill_from_git',
          arguments: {
            url: '/tmp/offisim-git-skill-source-round',
            subpath: 'smoke-skill-round',
            scope: 'employee',
            targetEmployeeId: employeeId,
          },
        },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    },
    conversationHistory: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'install skill' },
    ],
    preflight: {
      employee: {
        employee_id: employeeId,
        company_id: gitCompanyId,
        name: 'Round Sam',
        role_slug: 'engineer',
        config_json: null,
      },
      taskRunId: 'tr-git-skill-install-round',
      resolved: { provider: 'harness', model: 'model' },
    } as never,
    runtimeCtx,
    state: { projectId: projectIdFixture, threadId } as never,
    allowedMcpToolNames: new Set(),
  });

  assert.deepEqual(cloneArgs, { url: '/tmp/offisim-git-skill-source-round' });
  assert.equal(outcome.kind, 'typed_reply');
  if (outcome.kind === 'typed_reply') {
    assert.equal(outcome.content, 'Waiting for your input to continue.');
  }
  const pending = interactionService.getPending();
  assert.equal(pending?.kind, 'skill_install_confirm');
  assert.equal(pending?.context?.type, 'skill_install_confirm');
  assert.equal(pending?.context?.sourceKind, 'git');
  assert.equal(pending?.context?.resolvedEmployeeId, employeeId);
  staging.dispose();
}

async function assertInstalledReplayIsIdempotent() {
  const { service, repos } = createService();
  const installPlan = plan();
  await seedReadyTransaction(service, repos, 'txn-idempotent', installPlan);

  const first = await service.confirmBindings('txn-idempotent', []);
  const replay = await service.confirmBindings('txn-idempotent', []);

  assert.equal(replay.installedPackageId, first.installedPackageId);
  assert.deepEqual(replay.installedAssetIds, []);
  const installed = await repos.installedPackages.findByPackageId(
    companyId,
    installPlan.manifest.package.id,
  );
  assert.equal(installed.length, 1);
}

async function assertCachedMaterializingTransactionCanResume() {
  const { service, repos } = createService();
  const installPlan = plan('pkg.harness.materializing-resume', '1.0.0');
  await seedReadyTransaction(
    service,
    repos,
    'txn-materializing-resume',
    installPlan,
    'materializing',
  );

  const result = await service.confirmBindings('txn-materializing-resume', []);
  assert.ok(result.installedPackageId);
  const txn = await repos.installTransactions.findById('txn-materializing-resume');
  assert.equal(txn?.state, 'installed');
  assert.ok(txn?.finished_at);
  const installed = await repos.installedPackages.findByPackageId(
    companyId,
    installPlan.manifest.package.id,
  );
  assert.equal(installed.length, 1);
}

async function assertConcurrentSameVersionSerializesToTypedConflict() {
  const { service, repos } = createService();
  const installPlan = plan('pkg.harness.concurrent', '2.0.0');
  await seedReadyTransaction(service, repos, 'txn-a', installPlan);
  await seedReadyTransaction(service, repos, 'txn-b', installPlan);

  const results = await Promise.allSettled([
    service.confirmBindings('txn-a', []),
    service.confirmBindings('txn-b', []),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const reason = rejected[0]?.reason;
  assert.ok(reason instanceof InstallServiceError);
  assert.equal(reason.code, 'already_installed');
  const installed = await repos.installedPackages.findByPackageId(
    companyId,
    installPlan.manifest.package.id,
  );
  assert.equal(installed.length, 1);
}

await assertInstalledReplayIsIdempotent();
await assertCachedMaterializingTransactionCanResume();
await assertRegistryImportIdempotencyKeyReplaysActiveTransaction();
await assertRetryAfterFailedIdempotencyKeyCreatesNewAttempt();
await assertStaleMaterializingIdempotencyKeyCreatesNewAttempt();
await assertRegistryInstallHashMismatchFailsBeforeMaterialization();
await assertConcurrentSameVersionSerializesToTypedConflict();
await assertGitSkillInstallStagesAndMaterializesAfterConfirmation();
await assertSkillInstallToolRoundStopsForConfirmation();
assertReleaseDesktopUsesNativeInstallTransaction();
assertMcpStdioPolicyCoverage();
assertMarketplaceDoesNotInvokeMcpRegistration();
console.log('Install materialization harness passed');
