import type { RoleSlug } from '@offisim/shared-types';
import type { A2APeer } from './a2a-types.js';

export type ExternalDepartmentStatus = 'ready' | 'unconfigured';
export type ExternalDepartmentAvailability = 'available' | 'offline';
export type ExternalDepartmentAuthState = 'configured' | 'not_required' | 'missing';

export interface ExternalDepartmentSeed {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly keywords: readonly string[];
  readonly roleSlugHint: RoleSlug;
  readonly brandingIcon?: string;
  readonly peer?: Partial<A2APeer> & { readonly url?: string };
}

export interface ExternalDepartmentDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: 'external_department';
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly keywords: readonly string[];
  readonly roleSlugHint: RoleSlug;
  readonly brandingIcon?: string;
  readonly a2aUrl: string | null;
  readonly peer: A2APeer | null;
  readonly availability: ExternalDepartmentAvailability;
  readonly authState: ExternalDepartmentAuthState;
  readonly status: ExternalDepartmentStatus;
}

function normalizeCapabilityList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function defineExternalDepartments(
  seeds: readonly ExternalDepartmentSeed[],
): ExternalDepartmentDefinition[] {
  return seeds.map((seed) => {
    const url = seed.peer?.url?.trim() || null;
    const token = seed.peer?.token?.trim() || undefined;
    const peer = url
      ? {
          name: seed.peer?.name?.trim() || seed.name,
          url,
          token,
          agentId: seed.peer?.agentId?.trim() || undefined,
        }
      : null;
    const authState = url ? (token ? 'configured' : 'not_required') : 'missing';
    const status = url ? 'ready' : 'unconfigured';
    return {
      id: seed.id,
      name: seed.name,
      kind: 'external_department',
      summary: seed.summary,
      capabilities: normalizeCapabilityList(seed.capabilities),
      keywords: normalizeCapabilityList(seed.keywords).map((keyword) => keyword.toLowerCase()),
      roleSlugHint: seed.roleSlugHint,
      brandingIcon: seed.brandingIcon,
      a2aUrl: url,
      peer,
      availability: url ? 'available' : 'offline',
      authState,
      status,
    };
  });
}

export function matchExternalDepartments(
  intentText: string,
  departments: readonly ExternalDepartmentDefinition[],
): ExternalDepartmentDefinition[] {
  const normalizedIntent = intentText.toLowerCase();
  return departments.filter(
    (department) =>
      department.status === 'ready' &&
      department.keywords.some((keyword) => normalizedIntent.includes(keyword)),
  );
}

export function formatExternalDepartmentCatalog(
  departments: readonly ExternalDepartmentDefinition[],
): string {
  if (departments.length === 0) {
    return 'No external departments configured.';
  }
  return departments
    .map((department) => {
      const availability =
        department.status === 'ready'
          ? `${department.name} (${department.capabilities.join(', ')})`
          : `${department.name} (unconfigured)`;
      return `- ${availability}: ${department.summary}`;
    })
    .join('\n');
}
