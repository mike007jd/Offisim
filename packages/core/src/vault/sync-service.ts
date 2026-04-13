import type { RuntimeEvent, VaultSyncFailedPayload } from '@offisim/shared-types';
import { OffisimError } from '../errors.js';
import type { EventBus } from '../events/event-bus.js';
import type { EmployeeRepository, EmployeeRow, MemoryRepository } from '../runtime/repositories.js';
import { Logger } from '../services/logger.js';
import type { VaultFileSystem } from './fs.js';
import { type ImportDiagnostic, importEmployeeBundle } from './importer.js';
import { renderEmployeeMd, renderMemoryMd, renderRelationshipsMd, renderSoulMd } from './render.js';
import { employeeSlug } from './slug.js';

const logger = new Logger('vault-sync-service');

export interface VaultSyncServiceOptions {
  readonly fs: VaultFileSystem;
  readonly eventBus: EventBus;
  readonly employees: EmployeeRepository;
  readonly memories: MemoryRepository;
  readonly debounceMs?: number;
  readonly onError?: (err: VaultSyncError) => void;
}

export class VaultSyncError extends OffisimError {
  constructor(
    message: string,
    public readonly employeeId: string,
    public readonly cause?: unknown,
  ) {
    super(message, 'VAULT_SYNC_ERROR', true);
    this.name = 'VaultSyncError';
  }
}

export type VaultTarget = 'employee' | 'soul' | 'memory' | 'relationships';

const ALL_TARGETS: ReadonlySet<VaultTarget> = new Set<VaultTarget>([
  'employee',
  'soul',
  'memory',
  'relationships',
]);

interface PendingRender {
  readonly employeeId: string;
  readonly targets: Set<VaultTarget>;
  timer?: NodeJS.Timeout;
}

interface SlugRecord {
  readonly slug: string;
  readonly companyId: string;
}

export class VaultSyncService {
  private readonly fs: VaultFileSystem;
  private readonly eventBus: EventBus;
  private readonly employees: EmployeeRepository;
  private readonly memories: MemoryRepository;
  private readonly debounceMs: number;
  private readonly onError?: (err: VaultSyncError) => void;

  private readonly pending = new Map<string, PendingRender>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly slugByEmployee = new Map<string, SlugRecord>();
  private unsubscribes: Array<() => void> = [];
  private disposed = false;

  constructor(options: VaultSyncServiceOptions) {
    this.fs = options.fs;
    this.eventBus = options.eventBus;
    this.employees = options.employees;
    this.memories = options.memories;
    this.debounceMs = options.debounceMs ?? 500;
    this.onError = options.onError;
  }

  /** Attach to the event bus. Safe to call once. */
  subscribe(): void {
    if (this.disposed) {
      throw new Error('VaultSyncService is disposed');
    }
    if (this.unsubscribes.length > 0) {
      return;
    }
    this.unsubscribes.push(
      this.eventBus.on('employee.', (event) => this.handleEmployeeEvent(event)),
      this.eventBus.on('memory.', (event) => this.handleMemoryEvent(event)),
      this.eventBus.on('relationship.', (event) => this.handleRelationshipEvent(event)),
    );
  }

  /** Flush every pending debounce timer and await the resulting writes. */
  async flush(): Promise<void> {
    for (const [employeeId, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = undefined;
      }
      this.pending.delete(employeeId);
      this.enqueueRender(employeeId, pending.targets);
    }
    await Promise.all(this.inFlight.values());
  }

  /** Full desktop-side hydrate: render every employee and import anything newer. */
  async hydrateCompany(companyId: string): Promise<{
    rendered: number;
    importedEmployees: number;
    diagnostics: ImportDiagnostic[];
  }> {
    const rows = await this.employees.findByCompany(companyId);
    const diagnostics: ImportDiagnostic[] = [];
    let importedEmployees = 0;

    const outcomes = await Promise.all(
      rows.map(async (row) => {
        const record = this.slugRecordFor(row);
        const dir = this.employeeDir(record);
        const [existingEmployee, existingSoul] = await Promise.all([
          this.readIfExists(`${dir}/employee.md`),
          this.readIfExists(`${dir}/soul.md`),
        ]);

        let imported = false;
        const rowDiagnostics: ImportDiagnostic[] = [];
        if (existingEmployee || existingSoul) {
          const outcome = await importEmployeeBundle(this.employees, row, {
            ...(existingEmployee
              ? { employee: { content: existingEmployee, mtime: row.updated_at } }
              : {}),
            ...(existingSoul ? { soul: { content: existingSoul, mtime: row.updated_at } } : {}),
          });
          imported = outcome.applied > 0;
          rowDiagnostics.push(...outcome.diagnostics);
        }
        const refreshed = (await this.employees.findById(row.employee_id)) ?? row;
        await this.writeVaultFiles(refreshed, ALL_TARGETS);
        return { imported, diagnostics: rowDiagnostics };
      }),
    );

    for (const o of outcomes) {
      if (o.imported) {
        importedEmployees += 1;
      }
      for (const diag of o.diagnostics) {
        this.emitFailure(new VaultSyncError(diag.reason, diag.employeeId, diag.cause), 'import');
      }
      diagnostics.push(...o.diagnostics);
    }

    return { rendered: rows.length, importedEmployees, diagnostics };
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribes) {
      try {
        unsubscribe();
      } catch (err) {
        logger.warn('Unsubscribe failed', { err });
      }
    }
    this.unsubscribes = [];
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    this.pending.clear();
  }

  // -------------------- internals --------------------

  private handleEmployeeEvent(event: RuntimeEvent): void {
    const payload = event.payload as { employeeId?: string } | undefined;
    const employeeId = payload?.employeeId;
    if (!employeeId) {
      return;
    }
    if (event.type === 'employee.deleted') {
      void this.handleDeletion(employeeId);
      return;
    }
    // Created / updated / any state change: always render the full bundle so
    // new employees get all four files on disk in one debounce window.
    this.schedule(employeeId, new Set(['employee', 'soul', 'memory', 'relationships']));
  }

  private handleMemoryEvent(event: RuntimeEvent): void {
    // memory.accessed / memory.referenced only bump access_count in the DB —
    // they don't change the md content, so we skip the render to avoid
    // flooding vault writes during tool calls that hit memory frequently.
    if (event.type === 'memory.accessed' || event.type === 'memory.referenced') {
      return;
    }
    const payload = event.payload as
      | { employeeId?: string; ownerId?: string; scope?: string }
      | undefined;
    if (!payload || (payload.scope && payload.scope !== 'employee')) {
      return;
    }
    const employeeId = payload.employeeId ?? payload.ownerId;
    if (!employeeId) {
      return;
    }
    this.schedule(employeeId, new Set(['memory']));
  }

  private handleRelationshipEvent(event: RuntimeEvent): void {
    const payload = event.payload as { employeeId?: string } | undefined;
    const employeeId = payload?.employeeId;
    if (!employeeId) {
      return;
    }
    this.schedule(employeeId, new Set(['relationships']));
  }

  private schedule(employeeId: string, targets: Set<VaultTarget>): void {
    if (this.disposed) {
      return;
    }
    let entry = this.pending.get(employeeId);
    if (!entry) {
      entry = { employeeId, targets: new Set(targets) };
      this.pending.set(employeeId, entry);
    } else {
      for (const target of targets) {
        entry.targets.add(target);
      }
    }
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      const current = this.pending.get(employeeId);
      if (!current) {
        return;
      }
      this.pending.delete(employeeId);
      this.enqueueRender(employeeId, current.targets);
    }, this.debounceMs);
  }

  private enqueueRender(employeeId: string, targets: Set<VaultTarget>): void {
    const prior = this.inFlight.get(employeeId) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => this.doRender(employeeId, targets))
      .catch((err) => {
        const wrapped =
          err instanceof VaultSyncError ? err : new VaultSyncError(String(err), employeeId, err);
        logger.error(`Vault write failed for ${employeeId}`, wrapped);
        this.emitFailure(wrapped, 'write');
        this.onError?.(wrapped);
      })
      .finally(() => {
        if (this.inFlight.get(employeeId) === next) {
          this.inFlight.delete(employeeId);
        }
      });
    this.inFlight.set(employeeId, next);
  }

  private async doRender(employeeId: string, targets: Set<VaultTarget>): Promise<void> {
    const row = await this.employees.findById(employeeId);
    if (!row) {
      return;
    }
    await this.writeVaultFiles(row, targets);
  }

  private async writeVaultFiles(
    row: EmployeeRow,
    targets: ReadonlySet<VaultTarget>,
  ): Promise<void> {
    const record = this.slugRecordFor(row);
    const dir = this.employeeDir(record);
    const writes: Promise<void>[] = [];

    if (targets.has('employee')) {
      writes.push(this.fs.writeFile(`${dir}/employee.md`, renderEmployeeMd(row)));
    }
    if (targets.has('soul')) {
      writes.push(this.fs.writeFile(`${dir}/soul.md`, renderSoulMd(row)));
    }
    if (targets.has('relationships')) {
      writes.push(this.fs.writeFile(`${dir}/relationships.md`, renderRelationshipsMd(row)));
    }
    if (targets.has('memory')) {
      const memories = await this.memories.findByOwner(row.employee_id, { limit: 50 });
      writes.push(this.fs.writeFile(`${dir}/memory.md`, renderMemoryMd(row, memories)));
    }
    await Promise.all(writes);
  }

  private async readIfExists(relPath: string): Promise<string | undefined> {
    try {
      return await this.fs.readFile(relPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  private async handleDeletion(employeeId: string): Promise<void> {
    const record = this.slugByEmployee.get(employeeId);
    if (!record) {
      return;
    }
    this.slugByEmployee.delete(employeeId);
    const dir = this.employeeDir(record);
    try {
      await this.fs.remove(dir);
    } catch (err) {
      const wrapped = new VaultSyncError('Failed to delete vault directory', employeeId, err);
      logger.error(wrapped.message, wrapped);
      this.emitFailure(wrapped, 'delete');
      this.onError?.(wrapped);
    }
  }

  private emitFailure(err: VaultSyncError, target: VaultSyncFailedPayload['target']): void {
    const payload: VaultSyncFailedPayload = {
      employeeId: err.employeeId,
      reason: err.message,
      target,
    };
    const event: RuntimeEvent<VaultSyncFailedPayload> = {
      type: 'vault.sync.failed',
      entityId: err.employeeId,
      entityType: 'employee',
      companyId: this.slugByEmployee.get(err.employeeId)?.companyId ?? 'unknown',
      timestamp: Date.now(),
      payload,
    };
    try {
      this.eventBus.emit(event);
    } catch (emitErr) {
      logger.warn('Failed to emit vault.sync.failed event', { err: emitErr });
    }
  }

  private slugRecordFor(row: EmployeeRow): SlugRecord {
    const cached = this.slugByEmployee.get(row.employee_id);
    if (cached && cached.companyId === row.company_id) {
      return cached;
    }
    const record: SlugRecord = {
      companyId: row.company_id,
      slug: employeeSlug(row.name, row.employee_id),
    };
    this.slugByEmployee.set(row.employee_id, record);
    return record;
  }

  private employeeDir(record: SlugRecord): string {
    return `companies/${record.companyId}/employees/${record.slug}`;
  }

  /** Test-only hook: pre-seed the slug cache for fixtures that skip events. */
  rememberSlug(employeeId: string, companyId: string, slug: string): void {
    this.slugByEmployee.set(employeeId, { companyId, slug });
  }
}
