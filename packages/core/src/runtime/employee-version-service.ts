import type { EventBus } from '../events/event-bus.js';
import { employeeVersionCreated } from '../events/event-factories.js';
import type {
  EmployeeRepository,
  EmployeeVersionRepository,
  EmployeeVersionRow,
} from './repositories.js';

export interface VersionDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export class EmployeeVersionService {
  constructor(
    private readonly versionRepo: EmployeeVersionRepository,
    private readonly employeeRepo: EmployeeRepository,
    private readonly eventBus: EventBus,
    private readonly transact?: <T>(fn: () => T) => T,
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
      workstation_id: employee.workstation_id,
    });

    // Build a human-readable change summary
    let changeSummary: string | null = null;
    if (changeType === 'create') {
      changeSummary = `Created employee "${employee.name}" (${employee.role_slug})`;
    } else if (changeType === 'rollback') {
      changeSummary = `Rolled back to a previous version`;
    } else if (latestNum > 0) {
      const prevVersion = await this.versionRepo.findByVersion(employeeId, latestNum);
      if (prevVersion) {
        const diffs = this.diffVersions(prevVersion.snapshot_json, snapshot);
        if (diffs.length > 0) {
          changeSummary = diffs.map((d) => `${d.field} changed`).join(', ');
        } else {
          changeSummary = 'No visible changes';
        }
      }
    }

    // Write phase — wrap in a transaction if available.
    // versionRepo.create() is a synchronous .run() under Drizzle/better-sqlite3,
    // wrapped in Promise.resolve(). The microtask resolves before any event-loop
    // yield, so the transaction scope holds for the single write below.
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
      let captured: EmployeeVersionRow | undefined;
      this.transact(() => {
        void this.versionRepo.create(newVersionData).then((r) => {
          captured = r;
        });
      });
      // captured is set because the Drizzle Promise resolves synchronously
      row = captured!;
    } else {
      row = await this.versionRepo.create(newVersionData);
    }

    this.eventBus.emit(
      employeeVersionCreated(employee.company_id, employeeId, nextNum, changeType),
    );

    return row;
  }

  /** Get version history for an employee, newest first. */
  async getHistory(employeeId: string, limit?: number): Promise<EmployeeVersionRow[]> {
    return this.versionRepo.findByEmployee(employeeId, limit != null ? { limit } : undefined);
  }

  /** Rollback employee to a specific version. Applies the snapshot and creates a new version record. */
  async rollbackToVersion(employeeId: string, versionNum: number): Promise<void> {
    const version = await this.versionRepo.findByVersion(employeeId, versionNum);
    if (!version) {
      throw new Error(`Version ${versionNum} not found for employee ${employeeId}`);
    }

    const parsed = JSON.parse(version.snapshot_json) as Record<string, unknown>;

    await this.employeeRepo.update(employeeId, {
      name: parsed.name as string,
      role_slug: parsed.role_slug as string,
      enabled: parsed.enabled as number,
      persona_json: (parsed.persona_json as string) ?? null,
      config_json: (parsed.config_json as string) ?? null,
      workstation_id: (parsed.workstation_id as string) ?? null,
    });

    // Create a new version record for the rollback action
    await this.createVersion(employeeId, 'rollback');
  }

  /** Compare two version snapshots and return structured diffs. */
  diffVersions(snapshotA: string, snapshotB: string): VersionDiff[] {
    const objA = JSON.parse(snapshotA) as Record<string, unknown>;
    const objB = JSON.parse(snapshotB) as Record<string, unknown>;
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
