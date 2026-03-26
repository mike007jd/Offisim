import { ROLE_REGISTRY, ROLE_LABELS as _ROLE_LABELS_MAP } from '@aics/shared-types';

/** Hireable (non-system) roles for dropdowns / role pickers. */
export const ROLE_OPTIONS = ROLE_REGISTRY.filter((r) => !r.isSystem).map((r) => ({
  value: r.slug,
  label: r.label,
}));

/** Flat Record for quick label lookup (includes system roles). */
export const ROLE_LABELS: Record<string, string> = Object.fromEntries(_ROLE_LABELS_MAP);
