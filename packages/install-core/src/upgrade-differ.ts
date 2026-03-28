/**
 * Upgrade differ — computes a structured diff between two package manifest versions.
 *
 * Pure functions, no side effects. Used by the install UI to show users
 * what changed between their installed version and the new version.
 *
 * Diff categories:
 * - 'info'     — cosmetic / low-risk changes (description, tags, etc.)
 * - 'warning'  — notable changes that deserve attention (new dependencies, model changes)
 * - 'breaking' — changes that may break existing usage or require migration
 */

import type { PackageManifest } from '@offisim/asset-schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffSeverity = 'info' | 'warning' | 'breaking';

export type DiffCategory =
  | 'metadata'
  | 'compatibility'
  | 'requirements'
  | 'permissions'
  | 'assets'
  | 'distribution'
  | 'lineage';

export interface DiffEntry {
  readonly field: string;
  readonly category: DiffCategory;
  readonly severity: DiffSeverity;
  readonly description: string;
  readonly oldValue?: string;
  readonly newValue?: string;
}

export interface UpgradeDiff {
  /** Version transition */
  readonly fromVersion: string;
  readonly toVersion: string;
  /** All individual changes */
  readonly entries: readonly DiffEntry[];
  /** Highest severity across all entries */
  readonly maxSeverity: DiffSeverity;
  /** True if schema_version changed (may need data migration) */
  readonly requiresMigration: boolean;
  /** Convenience counts */
  readonly counts: {
    readonly info: number;
    readonly warning: number;
    readonly breaking: number;
  };
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<DiffSeverity, number> = {
  info: 0,
  warning: 1,
  breaking: 2,
};

function maxSeverity(a: DiffSeverity, b: DiffSeverity): DiffSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setDiff<T>(oldArr: readonly T[], newArr: readonly T[]): { added: T[]; removed: T[] } {
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);
  return {
    added: newArr.filter((item) => !oldSet.has(item)),
    removed: oldArr.filter((item) => !newSet.has(item)),
  };
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '(none)';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Diff logic per section
// ---------------------------------------------------------------------------

function diffMetadata(oldM: PackageManifest, newM: PackageManifest, entries: DiffEntry[]): void {
  const oldPkg = oldM.package;
  const newPkg = newM.package;

  // Title change
  if (oldPkg.title !== newPkg.title) {
    entries.push({
      field: 'package.title',
      category: 'metadata',
      severity: 'info',
      description: 'Package title changed',
      oldValue: oldPkg.title,
      newValue: newPkg.title,
    });
  }

  // Summary change
  if ((oldPkg.summary ?? '') !== (newPkg.summary ?? '')) {
    entries.push({
      field: 'package.summary',
      category: 'metadata',
      severity: 'info',
      description: 'Package summary changed',
      oldValue: oldPkg.summary ?? '(none)',
      newValue: newPkg.summary ?? '(none)',
    });
  }

  // Kind change (breaking — package type changed)
  if (oldPkg.kind !== newPkg.kind) {
    entries.push({
      field: 'package.kind',
      category: 'metadata',
      severity: 'breaking',
      description: `Package kind changed from '${oldPkg.kind}' to '${newPkg.kind}'`,
      oldValue: oldPkg.kind,
      newValue: newPkg.kind,
    });
  }

  // License change
  if (oldPkg.license !== newPkg.license) {
    entries.push({
      field: 'package.license',
      category: 'metadata',
      severity: 'warning',
      description: 'License changed',
      oldValue: oldPkg.license,
      newValue: newPkg.license,
    });
  }

  // Tags change
  const oldTags = oldPkg.tags ?? [];
  const newTags = newPkg.tags ?? [];
  const tagDiff = setDiff(oldTags, newTags);
  if (tagDiff.added.length > 0 || tagDiff.removed.length > 0) {
    entries.push({
      field: 'package.tags',
      category: 'metadata',
      severity: 'info',
      description: [
        tagDiff.added.length > 0 ? `Added tags: ${tagDiff.added.join(', ')}` : '',
        tagDiff.removed.length > 0 ? `Removed tags: ${tagDiff.removed.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. '),
      oldValue: oldTags.join(', ') || '(none)',
      newValue: newTags.join(', ') || '(none)',
    });
  }

  // spec_version change
  if (oldM.spec_version !== newM.spec_version) {
    entries.push({
      field: 'spec_version',
      category: 'metadata',
      severity: 'warning',
      description: 'Manifest spec version changed',
      oldValue: oldM.spec_version,
      newValue: newM.spec_version,
    });
  }
}

function diffCompatibility(
  oldM: PackageManifest,
  newM: PackageManifest,
  entries: DiffEntry[],
): void {
  const oldC = oldM.compatibility;
  const newC = newM.compatibility;

  // Runtime range change
  if (oldC.runtime_range !== newC.runtime_range) {
    entries.push({
      field: 'compatibility.runtime_range',
      category: 'compatibility',
      severity: 'warning',
      description: 'Runtime version range changed',
      oldValue: oldC.runtime_range,
      newValue: newC.runtime_range,
    });
  }

  // Schema version change (may need migration)
  if (oldC.schema_version !== newC.schema_version) {
    entries.push({
      field: 'compatibility.schema_version',
      category: 'compatibility',
      severity: 'breaking',
      description: 'Schema version changed — data migration may be required',
      oldValue: oldC.schema_version,
      newValue: newC.schema_version,
    });
  }

  // Supported environments change
  const envDiff = setDiff(oldC.supported_environments, newC.supported_environments);
  if (envDiff.removed.length > 0) {
    entries.push({
      field: 'compatibility.supported_environments',
      category: 'compatibility',
      severity: 'breaking',
      description: `Dropped environment support: ${envDiff.removed.join(', ')}`,
      oldValue: oldC.supported_environments.join(', '),
      newValue: newC.supported_environments.join(', '),
    });
  }
  if (envDiff.added.length > 0) {
    entries.push({
      field: 'compatibility.supported_environments',
      category: 'compatibility',
      severity: 'info',
      description: `Added environment support: ${envDiff.added.join(', ')}`,
      oldValue: oldC.supported_environments.join(', '),
      newValue: newC.supported_environments.join(', '),
    });
  }
}

function diffRequirements(
  oldM: PackageManifest,
  newM: PackageManifest,
  entries: DiffEntry[],
): void {
  const oldR = oldM.requirements;
  const newR = newM.requirements;

  // Required capabilities
  const capDiff = setDiff(oldR.required_capabilities, newR.required_capabilities);
  if (capDiff.added.length > 0) {
    entries.push({
      field: 'requirements.required_capabilities',
      category: 'requirements',
      severity: 'warning',
      description: `New required capabilities: ${capDiff.added.join(', ')}`,
      oldValue: oldR.required_capabilities.join(', ') || '(none)',
      newValue: newR.required_capabilities.join(', ') || '(none)',
    });
  }
  if (capDiff.removed.length > 0) {
    entries.push({
      field: 'requirements.required_capabilities',
      category: 'requirements',
      severity: 'info',
      description: `Removed required capabilities: ${capDiff.removed.join(', ')}`,
      oldValue: oldR.required_capabilities.join(', ') || '(none)',
      newValue: newR.required_capabilities.join(', ') || '(none)',
    });
  }

  // Required MCPs
  const mcpDiff = setDiff(oldR.required_mcps, newR.required_mcps);
  if (mcpDiff.added.length > 0) {
    entries.push({
      field: 'requirements.required_mcps',
      category: 'requirements',
      severity: 'warning',
      description: `New required MCPs: ${mcpDiff.added.join(', ')}`,
      oldValue: oldR.required_mcps.join(', ') || '(none)',
      newValue: newR.required_mcps.join(', ') || '(none)',
    });
  }
  if (mcpDiff.removed.length > 0) {
    entries.push({
      field: 'requirements.required_mcps',
      category: 'requirements',
      severity: 'info',
      description: `Removed required MCPs: ${mcpDiff.removed.join(', ')}`,
      oldValue: oldR.required_mcps.join(', ') || '(none)',
      newValue: newR.required_mcps.join(', ') || '(none)',
    });
  }

  // Optional MCPs
  const oldOptMcps = oldR.optional_mcps ?? [];
  const newOptMcps = newR.optional_mcps ?? [];
  const optMcpDiff = setDiff(oldOptMcps, newOptMcps);
  if (optMcpDiff.added.length > 0 || optMcpDiff.removed.length > 0) {
    entries.push({
      field: 'requirements.optional_mcps',
      category: 'requirements',
      severity: 'info',
      description: [
        optMcpDiff.added.length > 0 ? `Added optional MCPs: ${optMcpDiff.added.join(', ')}` : '',
        optMcpDiff.removed.length > 0
          ? `Removed optional MCPs: ${optMcpDiff.removed.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('. '),
      oldValue: oldOptMcps.join(', ') || '(none)',
      newValue: newOptMcps.join(', ') || '(none)',
    });
  }

  // Recommended models
  const oldModels = (oldR.recommended_models ?? []).map((m) => m.profile).sort();
  const newModels = (newR.recommended_models ?? []).map((m) => m.profile).sort();
  const modelDiff = setDiff(oldModels, newModels);
  if (modelDiff.added.length > 0 || modelDiff.removed.length > 0) {
    entries.push({
      field: 'requirements.recommended_models',
      category: 'requirements',
      severity: 'info',
      description: [
        modelDiff.added.length > 0 ? `New recommended models: ${modelDiff.added.join(', ')}` : '',
        modelDiff.removed.length > 0
          ? `Removed recommended models: ${modelDiff.removed.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('. '),
      oldValue: oldModels.join(', ') || '(none)',
      newValue: newModels.join(', ') || '(none)',
    });
  }
}

function diffPermissions(oldM: PackageManifest, newM: PackageManifest, entries: DiffEntry[]): void {
  const oldP = oldM.permissions;
  const newP = newM.permissions;

  // Risk class escalation
  if (oldP.risk_class !== newP.risk_class) {
    const riskOrder = { data_asset: 0, logic_asset: 1, privileged_asset: 2 } as const;
    const oldLevel = riskOrder[oldP.risk_class] ?? 0;
    const newLevel = riskOrder[newP.risk_class] ?? 0;
    const escalated = newLevel > oldLevel;

    entries.push({
      field: 'permissions.risk_class',
      category: 'permissions',
      severity: escalated ? 'breaking' : 'info',
      description: escalated
        ? `Risk class ESCALATED from '${oldP.risk_class}' to '${newP.risk_class}'`
        : `Risk class changed from '${oldP.risk_class}' to '${newP.risk_class}'`,
      oldValue: oldP.risk_class,
      newValue: newP.risk_class,
    });
  }

  // Filesystem scope change
  if (oldP.filesystem_scope !== newP.filesystem_scope) {
    const fsOrder = { none: 0, workspace: 1, project: 2, custom_path: 3 } as const;
    const oldLevel = fsOrder[oldP.filesystem_scope] ?? 0;
    const newLevel = fsOrder[newP.filesystem_scope] ?? 0;
    const escalated = newLevel > oldLevel;

    entries.push({
      field: 'permissions.filesystem_scope',
      category: 'permissions',
      severity: escalated ? 'breaking' : 'info',
      description: escalated
        ? `Filesystem access ESCALATED from '${oldP.filesystem_scope}' to '${newP.filesystem_scope}'`
        : `Filesystem access changed from '${oldP.filesystem_scope}' to '${newP.filesystem_scope}'`,
      oldValue: oldP.filesystem_scope,
      newValue: newP.filesystem_scope,
    });
  }

  // Network scope change
  if (oldP.network_scope !== newP.network_scope) {
    const netOrder = { none: 0, limited: 1, unrestricted: 2 } as const;
    const oldLevel = netOrder[oldP.network_scope] ?? 0;
    const newLevel = netOrder[newP.network_scope] ?? 0;
    const escalated = newLevel > oldLevel;

    entries.push({
      field: 'permissions.network_scope',
      category: 'permissions',
      severity: escalated ? 'breaking' : 'info',
      description: escalated
        ? `Network access ESCALATED from '${oldP.network_scope}' to '${newP.network_scope}'`
        : `Network access changed from '${oldP.network_scope}' to '${newP.network_scope}'`,
      oldValue: oldP.network_scope,
      newValue: newP.network_scope,
    });
  }

  // Secrets declaration change
  if (oldP.declares_secrets !== newP.declares_secrets) {
    entries.push({
      field: 'permissions.declares_secrets',
      category: 'permissions',
      severity: newP.declares_secrets ? 'warning' : 'info',
      description: newP.declares_secrets
        ? 'Package now declares secrets (previously none)'
        : 'Package no longer declares secrets',
      oldValue: String(oldP.declares_secrets),
      newValue: String(newP.declares_secrets),
    });
  }

  // Secret slots change
  const oldSlots = oldP.secret_slots_required ?? [];
  const newSlots = newP.secret_slots_required ?? [];
  const slotDiff = setDiff(oldSlots, newSlots);
  if (slotDiff.added.length > 0) {
    entries.push({
      field: 'permissions.secret_slots_required',
      category: 'permissions',
      severity: 'warning',
      description: `New secret slots required: ${slotDiff.added.join(', ')}`,
      oldValue: oldSlots.join(', ') || '(none)',
      newValue: newSlots.join(', ') || '(none)',
    });
  }
  if (slotDiff.removed.length > 0) {
    entries.push({
      field: 'permissions.secret_slots_required',
      category: 'permissions',
      severity: 'info',
      description: `Removed secret slots: ${slotDiff.removed.join(', ')}`,
      oldValue: oldSlots.join(', ') || '(none)',
      newValue: newSlots.join(', ') || '(none)',
    });
  }
}

function diffAssets(oldM: PackageManifest, newM: PackageManifest, entries: DiffEntry[]): void {
  const oldIds = new Set(oldM.assets.map((a) => a.asset_id));
  const newIds = new Set(newM.assets.map((a) => a.asset_id));

  const added = newM.assets.filter((a) => !oldIds.has(a.asset_id));
  const removed = oldM.assets.filter((a) => !newIds.has(a.asset_id));

  if (added.length > 0) {
    entries.push({
      field: 'assets',
      category: 'assets',
      severity: 'info',
      description: `Added assets: ${added.map((a) => `${a.asset_id} (${a.kind})`).join(', ')}`,
      newValue: added.map((a) => a.asset_id).join(', '),
    });
  }

  if (removed.length > 0) {
    entries.push({
      field: 'assets',
      category: 'assets',
      severity: 'warning',
      description: `Removed assets: ${removed.map((a) => `${a.asset_id} (${a.kind})`).join(', ')}`,
      oldValue: removed.map((a) => a.asset_id).join(', '),
    });
  }

  // Check for kind changes in shared assets
  for (const newAsset of newM.assets) {
    if (!oldIds.has(newAsset.asset_id)) continue;
    const oldAsset = oldM.assets.find((a) => a.asset_id === newAsset.asset_id);
    if (!oldAsset) continue;
    if (oldAsset.kind !== newAsset.kind) {
      entries.push({
        field: `assets.${newAsset.asset_id}.kind`,
        category: 'assets',
        severity: 'breaking',
        description: `Asset '${newAsset.asset_id}' kind changed from '${oldAsset.kind}' to '${newAsset.kind}'`,
        oldValue: oldAsset.kind,
        newValue: newAsset.kind,
      });
    }
  }
}

function diffDistribution(
  oldM: PackageManifest,
  newM: PackageManifest,
  entries: DiffEntry[],
): void {
  const oldD = oldM.distribution;
  const newD = newM.distribution;
  if (!oldD && !newD) return;

  const oldSize = oldD?.artifact_size_bytes;
  const newSize = newD?.artifact_size_bytes;
  if (oldSize !== undefined && newSize !== undefined && oldSize !== newSize) {
    entries.push({
      field: 'distribution.artifact_size_bytes',
      category: 'distribution',
      severity: 'info',
      description: `Package size changed from ${formatValue(oldSize)} to ${formatValue(newSize)} bytes`,
      oldValue: formatValue(oldSize),
      newValue: formatValue(newSize),
    });
  }

  const oldPolicy = oldD?.mirror_policy;
  const newPolicy = newD?.mirror_policy;
  if (oldPolicy !== newPolicy) {
    entries.push({
      field: 'distribution.mirror_policy',
      category: 'distribution',
      severity: 'info',
      description: 'Mirror policy changed',
      oldValue: formatValue(oldPolicy),
      newValue: formatValue(newPolicy),
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a structured diff between the current (installed) manifest and a new manifest.
 *
 * Pure function — no I/O, no side effects.
 */
export function computeUpgradeDiff(
  currentManifest: PackageManifest,
  newManifest: PackageManifest,
): UpgradeDiff {
  const entries: DiffEntry[] = [];

  diffMetadata(currentManifest, newManifest, entries);
  diffCompatibility(currentManifest, newManifest, entries);
  diffRequirements(currentManifest, newManifest, entries);
  diffPermissions(currentManifest, newManifest, entries);
  diffAssets(currentManifest, newManifest, entries);
  diffDistribution(currentManifest, newManifest, entries);

  const counts = { info: 0, warning: 0, breaking: 0 };
  let highest: DiffSeverity = 'info';
  for (const entry of entries) {
    counts[entry.severity]++;
    highest = maxSeverity(highest, entry.severity);
  }

  const requiresMigration =
    currentManifest.compatibility.schema_version !== newManifest.compatibility.schema_version;

  return {
    fromVersion: currentManifest.package.version,
    toVersion: newManifest.package.version,
    entries,
    maxSeverity: highest,
    requiresMigration,
    counts,
  };
}
