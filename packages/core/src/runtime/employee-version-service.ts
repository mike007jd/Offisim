import type { RoleSlug } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { employeeVersionCreated } from '../events/event-factories.js';
import type {
  EmployeeRepository,
  EmployeeVersionRepository,
  EmployeeVersionRow,
} from './repositories.js';

interface EmployeeVersionTxRepos {
  readonly employeeVersions: EmployeeVersionRepository;
  readonly employees: EmployeeRepository;
}

export interface VersionDiff {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Parse a DB-sourced snapshot_json blob defensively. Corrupt or non-object
 * JSON returns null rather than throwing, so a single malformed row cannot
 * abort history/diff/rollback flows.
 */
function parseSnapshot(snapshotJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(snapshotJson) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class EmployeeVersionService {
  constructor(
    private readonly versionRepo: EmployeeVersionRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly eventBus: EventBus,
    private readonly transact?: <T>(fn: () => T) => T,
    private readonly asyncTransact?: <T>(
      fn: (txRepos?: EmployeeVersionTxRepos) => Promise<T>,
    ) => Promise<T>,
  ) {}

  /** Snapshot current employee state as a new version. */
  async createVersion(
    employeeId: string,
    changeType: 'create' | 'update' | 'rollback',
    createdBy = 'user',
  ): Promise<EmployeeVersionRow> {
    // Read phase — these are reads only and happen outside the transaction.
    const employee = await this.employeeRepo.findById(employeeId);
    if (!employee) {
      throw new Error(`Employee not found: ${employeeId}`);
    }

    const latestNum = await this.versionRepo.getLatestVersionNum(employeeId);
    const nextNum = latestNum + 1;

    const snapshot = JSON.stringify({
      name: employee.name,
      role_slug: employee.role_slug,
      enabled: employee.enabled,
      persona_json: employee.persona_json,
      config_json: employee.config_json,
      model: employee.model,
      thinking_level: employee.thinking_level,
      workstation_id: employee.workstation_id,
    });

    // Build a human-readable change summary
    let changeSummary: string | null = null;
    if (changeType === 'create') {
      changeSummary = `Created employee "${employee.name}" (${employee.role_slug})`;
    } else if (changeType === 'rollback') {
      changeSummary = 'Rolled back to a previous version';
    } else if (latestNum > 0) {
      const prevVersion = await this.versionRepo.findByVersion(employeeId, latestNum);
      if (prevVersion) {
        const prevParsed = parseSnapshot(prevVersion.snapshot_json);
        if (prevParsed === null) {
          changeSummary = 'change summary unavailable';
        } else {
          const diffs = this.diffVersions(prevVersion.snapshot_json, snapshot);
          if (diffs.length > 0) {
            changeSummary = diffs.map((d) => `${d.field} changed`).join(', ');
          } else {
            changeSummary = 'No visible changes';
          }
        }
      }
    }

    // Write phase — wrap in a transaction if available.
    const newVersionData = {
      employee_id: employeeId,
      version_num: nextNum,
      change_type: changeType,
      snapshot_json: snapshot,
      change_summary: changeSummary,
      created_by: createdBy,
    };

    let row: EmployeeVersionRow;
    if (this.transact) {
      row = await this.transact(() => this.versionRepo.create(newVersionData));
    } else {
      row = await this.versionRepo.create(newVersionData);
    }

    this.eventBus.emit(
      employeeVersionCreated(employee.company_id, employeeId, nextNum, changeType),
    );

    return row;
  }

  /**
   * Get version history for an employee, newest first. `limit`, when provided,
   * must be a positive integer; non-positive or non-integer values are treated
   * as "no limit" so a stray `0` cannot be misread as "zero rows" by backends
   * that do not all agree on the LIMIT 0 case.
   */
  async getHistory(employeeId: string, limit?: number): Promise<EmployeeVersionRow[]> {
    const hasLimit = limit != null && Number.isInteger(limit) && limit > 0;
    return this.versionRepo.findByEmployee(employeeId, hasLimit ? { limit } : undefined);
  }

  /** Rollback employee to a specific version. Applies the snapshot and creates a new version record. */
  async rollbackToVersion(employeeId: string, versionNum: number): Promise<void> {
    const version = await this.versionRepo.findByVersion(employeeId, versionNum);
    if (!version) {
      throw new Error(`Version ${versionNum} not found for employee ${employeeId}`);
    }

    const employee = await this.employeeRepo.findById(employeeId);
    if (!employee) {
      throw new Error(`Employee not found: ${employeeId}`);
    }

    const parsed = parseSnapshot(version.snapshot_json);
    if (parsed === null) {
      throw new Error(
        `Snapshot for version ${versionNum} of employee ${employeeId} is corrupt and cannot be rolled back`,
      );
    }
    if (typeof parsed.name !== 'string' || typeof parsed.role_slug !== 'string') {
      throw new Error(
        `Snapshot for version ${versionNum} of employee ${employeeId} is missing required fields`,
      );
    }
    const snapshot = {
      name: parsed.name,
      role_slug: parsed.role_slug as RoleSlug,
      enabled: parsed.enabled as number,
      persona_json: (parsed.persona_json as string) ?? null,
      config_json: (parsed.config_json as string) ?? null,
      model: (parsed.model as string) ?? null,
      thinking_level: (parsed.thinking_level as string) ?? null,
      workstation_id: (parsed.workstation_id as string) ?? null,
    };

    // The rollback applies a known snapshot, so the new version record mirrors
    // exactly what we just wrote (no employee re-read needed — the Tauri queued
    // transaction has no read-your-own-write isolation).
    const apply = async (txRepos?: EmployeeVersionTxRepos): Promise<number> => {
      const employeeRepo = txRepos?.employees ?? this.employeeRepo;
      const versionRepo = txRepos?.employeeVersions ?? this.versionRepo;

      await employeeRepo.update(employeeId, snapshot);

      // Allocate the next version number inside the transaction so two
      // concurrent rollbacks cannot collide on the same version_num.
      const nextNum = (await versionRepo.getLatestVersionNum(employeeId)) + 1;
      await versionRepo.create({
        employee_id: employeeId,
        version_num: nextNum,
        change_type: 'rollback',
        snapshot_json: JSON.stringify(snapshot),
        change_summary: 'Rolled back to a previous version',
        created_by: 'user',
      });
      return nextNum;
    };

    let nextNum: number;
    if (this.asyncTransact) {
      // Snapshot-apply + version-record write commit atomically.
      nextNum = await this.asyncTransact((txRepos) => apply(txRepos));
    } else {
      // Memory backend (no transactional boundary) — sequential is equivalent.
      nextNum = await apply();
    }

    this.eventBus.emit(
      employeeVersionCreated(employee.company_id, employeeId, nextNum, 'rollback'),
    );
  }

  /** Compare two version snapshots and return structured diffs. */
  diffVersions(snapshotA: string, snapshotB: string): VersionDiff[] {
    const objA = parseSnapshot(snapshotA);
    const objB = parseSnapshot(snapshotB);
    if (objA === null || objB === null) {
      // Corrupt snapshot — no reliable diff can be produced.
      return [];
    }
    const diffs: VersionDiff[] = [];

    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      const valA = typeof objA[key] === 'object' ? JSON.stringify(objA[key]) : objA[key];
      const valB = typeof objB[key] === 'object' ? JSON.stringify(objB[key]) : objB[key];
      if (valA !== valB) {
        diffs.push({ field: key, from: objA[key], to: objB[key] });
      }
    }
    return diffs;
  }
}
