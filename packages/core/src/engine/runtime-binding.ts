import type { EmployeeRuntimeBinding, EngineId, RuntimePolicyConfig } from '@offisim/shared-types';
import type { EmployeeRow } from '../runtime/repositories.js';

const PROVIDER_RUNTIME_BINDING: EmployeeRuntimeBinding = { mode: 'provider' };

function isEngineId(value: unknown): value is EngineId {
  return value === 'codex-engine' || value === 'claude-engine';
}

function parseRuntimeBinding(raw: unknown): EmployeeRuntimeBinding | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidate = raw as { mode?: unknown; engineId?: unknown };
  if (candidate.mode === 'provider') return PROVIDER_RUNTIME_BINDING;
  if (candidate.mode === 'engine' && isEngineId(candidate.engineId)) {
    return { mode: 'engine', engineId: candidate.engineId };
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
