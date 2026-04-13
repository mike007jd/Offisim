import { type EventBus, employeeCreated, employeeSlug } from '@offisim/core/browser';
import type { RuntimeEvent, VaultSyncFailedPayload } from '@offisim/shared-types';
import type { RuntimeBundle } from '../lib/browser-runtime';
import { activateVaultSync } from '../lib/vault-activation';
import { type TauriFsModule, TauriVaultFileSystem } from '../lib/vault-tauri-fs';

interface VaultDevSmokeDeps {
  appDataDir?: () => Promise<string>;
  employeeIdFactory?: () => string;
  fsMod?: TauriFsModule;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  slugFactory?: (name: string, employeeId: string) => string;
  windowObj?: Record<string, unknown> | undefined;
}

type LoadedTauriDeps =
  | {
      appDataDir: () => Promise<string>;
      fsMod: TauriFsModule;
      loadErr: null;
    }
  | {
      appDataDir: null;
      fsMod: null;
      loadErr: string;
    };

export async function runVaultDevSmoke(params: {
  companyId: string;
  eventBus: EventBus;
  runtime: RuntimeBundle | null;
  deps?: VaultDevSmokeDeps;
}): Promise<unknown> {
  const { companyId, eventBus, runtime, deps } = params;
  const windowObj = deps?.windowObj ?? (typeof window !== 'undefined' ? window : undefined);
  const probe = {
    has_TAURI: Boolean(windowObj && '__TAURI__' in windowObj),
    has_TAURI_INTERNALS: Boolean(windowObj && '__TAURI_INTERNALS__' in windowObj),
    runtimeReady: !!runtime,
    runtimeHasVaultActivation: !!runtime?.vaultActivation,
    runtimeReposEmployees: typeof runtime?.repos?.employees?.create === 'function',
  };
  const tauriDeps = await loadTauriDeps(deps);
  if (!tauriDeps.appDataDir || !tauriDeps.fsMod) {
    return {
      ok: false as const,
      reason: 'failed to load @tauri-apps/api/path or /plugin-fs at runtime',
      loadErr: tauriDeps.loadErr,
      probe,
    };
  }
  let root: string;
  try {
    root = `${(await tauriDeps.appDataDir()).replace(/\/+$/u, '')}/vault`;
  } catch (err) {
    return {
      ok: false as const,
      reason: 'appDataDir() threw',
      err: err instanceof Error ? err.message : String(err),
      probe,
    };
  }
  try {
    await tauriDeps.fsMod.mkdir(`${root}/__smoke_probe__`, { recursive: true });
  } catch (err) {
    return {
      ok: false as const,
      reason: 'fs.mkdir probe failed — capability / plugin-fs not reachable',
      err: err instanceof Error ? err.message : String(err),
      root,
      probe,
    };
  }
  if (!runtime) {
    return {
      ok: false as const,
      reason: 'runtime not ready, but fs capability IS working',
      root,
      probe,
    };
  }
  const failures: RuntimeEvent<VaultSyncFailedPayload>[] = [];
  const unsubscribeVaultFailures = eventBus.on('vault.sync.failed', (event) => {
    failures.push(event as RuntimeEvent<VaultSyncFailedPayload>);
  });

  const activeActivation = runtime.vaultActivation
    ? null
    : activateVaultSync({
        fs: new TauriVaultFileSystem(root),
        eventBus: eventBus as Parameters<typeof activateVaultSync>[0]['eventBus'],
        repos: runtime.repos,
        companyId,
      });
  const vaultActivation = runtime.vaultActivation ?? activeActivation;
  const requestedEmployeeId = deps?.employeeIdFactory?.() ?? crypto.randomUUID();
  const name = `Vault Smoke ${(deps?.now ?? Date.now)()}`;
  const roleSlug = 'engineer';
  try {
    const createdEmployee = await runtime.repos.employees.create({
      employee_id: requestedEmployeeId,
      company_id: companyId,
      source_asset_id: null,
      source_package_id: null,
      name,
      role_slug: roleSlug,
    });
    const employeeId = createdEmployee.employee_id ?? requestedEmployeeId;
    const persistedEmployee = await runtime.repos.employees.findById(employeeId);
    eventBus.emit(employeeCreated(companyId, employeeId, name, roleSlug));

    if (vaultActivation?.service?.flush) {
      await vaultActivation.service.flush();
    } else {
      await (deps?.sleep ?? defaultSleep)(900);
    }

    const slug = (deps?.slugFactory ?? employeeSlug)(name, employeeId);
    const base = `${root}/companies/${companyId}/employees/${slug}`;
    const fileNames = ['employee.md', 'soul.md', 'memory.md', 'relationships.md'];
    const files: Record<string, { exists: boolean; bytes: number; head: string }> = {};
    for (const fileName of fileNames) {
      files[fileName] = await readVaultSmokeFile(tauriDeps.fsMod, `${base}/${fileName}`);
    }
    const allOk = fileNames.every((fileName) => files[fileName]?.exists);
    return {
      ok: allOk,
      ...(allOk
        ? {}
        : {
            reason: failures[0]?.payload.reason ?? 'vault files were not materialized after flush',
          }),
      root,
      employeeId,
      slug,
      base,
      probe,
      persistedEmployee:
        persistedEmployee === null
          ? null
          : {
              employee_id: persistedEmployee.employee_id,
              company_id: persistedEmployee.company_id,
              name: persistedEmployee.name,
              role_slug: persistedEmployee.role_slug,
            },
      failures: failures.map((event) => ({
        target: event.payload.target,
        employeeId: event.payload.employeeId,
        reason: event.payload.reason,
      })),
      files,
    };
  } finally {
    unsubscribeVaultFailures();
    activeActivation?.dispose();
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTauriDeps(deps?: VaultDevSmokeDeps): Promise<LoadedTauriDeps> {
  if (deps?.appDataDir && deps?.fsMod) {
    return {
      appDataDir: deps.appDataDir,
      fsMod: deps.fsMod,
      loadErr: null,
    };
  }

  try {
    const [pathApi, fsApi] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ]);
    return {
      appDataDir: deps?.appDataDir ?? (pathApi as { appDataDir: () => Promise<string> }).appDataDir,
      fsMod: deps?.fsMod ?? (fsApi as TauriFsModule),
      loadErr: null,
    };
  } catch (err) {
    return {
      appDataDir: null,
      fsMod: null,
      loadErr: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readVaultSmokeFile(
  fsMod: TauriFsModule,
  filePath: string,
): Promise<{ exists: boolean; bytes: number; head: string }> {
  try {
    const exists = await fsMod.exists(filePath);
    if (!exists) {
      return { exists: false, bytes: 0, head: '' };
    }

    const content = await fsMod.readTextFile(filePath);
    return { exists: true, bytes: content.length, head: content.slice(0, 80) };
  } catch (err) {
    return {
      exists: false,
      bytes: 0,
      head: `ERR: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
