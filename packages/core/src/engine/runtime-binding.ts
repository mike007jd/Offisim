import {
  ENGINE_IDS,
  type EmployeeRuntimeBinding,
  type EngineId,
  type RuntimePolicyConfig,
} from '@offisim/shared-types';
import type { EmployeeRow } from '../runtime/repositories.js';

const PROVIDER_RUNTIME_BINDING: EmployeeRuntimeBinding = { mode: 'provider' };

function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

function parseRuntimeBinding(raw: unknown): EmployeeRuntimeBinding | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as { mode?: unknown; engineId?: unknown };
  if (candidate.mode === 'provider') return PROVIDER_RUNTIME_BINDING;
  if (candidate.mode === 'engine' && isEngineId(candidate.engineId)) {
    const profileId =
      'profileId' in candidate && typeof candidate.profileId === 'string'
        ? candidate.profileId.trim()
        : '';
    return {
      mode: 'engine',
      engineId: candidate.engineId,
      ...(profileId ? { profileId } : {}),
    };
  }
  return undefined;
}

function parseEmployeeConfigRuntimeBinding(raw: string | null): EmployeeRuntimeBinding | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parseRuntimeBinding((parsed as { runtimeBinding?: unknown }).runtimeBinding);
  } catch {
    return undefined;
  }
}

export function resolveEmployeeRuntimeBinding(
  employee: Pick<EmployeeRow, 'config_json' | 'is_external'>,
  runtimePolicy: Pick<RuntimePolicyConfig, 'employeeRuntimeDefault'> | null | undefined,
): EmployeeRuntimeBinding {
  if (employee.is_external === 1) {
    return PROVIDER_RUNTIME_BINDING;
  }

  return (
    parseEmployeeConfigRuntimeBinding(employee.config_json) ??
    parseRuntimeBinding(runtimePolicy?.employeeRuntimeDefault) ??
    PROVIDER_RUNTIME_BINDING
  );
}

/**
 * Parsed-input variant for callers (UI form state) that already hold a
 * `EmployeeRuntimeBinding | null` and don't need the JSON-string parse path.
 * Same precedence: external → provider; override; company default; provider.
 */
export function resolveRuntimeBindingFromInput(
  input: { binding: EmployeeRuntimeBinding | null; isExternal: boolean },
  runtimePolicy: Pick<RuntimePolicyConfig, 'employeeRuntimeDefault'> | null | undefined,
): EmployeeRuntimeBinding {
  if (input.isExternal) return PROVIDER_RUNTIME_BINDING;
  return input.binding ?? runtimePolicy?.employeeRuntimeDefault ?? PROVIDER_RUNTIME_BINDING;
}

/**
 * Structural equality for `EmployeeRuntimeBinding | null`. Handy when comparing
 * form / context values where reference identity is unstable.
 */
export function runtimeBindingsEqual(
  a: EmployeeRuntimeBinding | null | undefined,
  b: EmployeeRuntimeBinding | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'engine' && b.mode === 'engine') {
    return a.engineId === b.engineId && (a.profileId ?? null) === (b.profileId ?? null);
  }
  return true;
}
