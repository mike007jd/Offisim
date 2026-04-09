import { ROLE_REGISTRY, ROLE_LABELS as _ROLE_LABELS_MAP } from '@offisim/shared-types';

/** Hireable (non-system) role entries — full RoleEntry objects. */
export const HIREABLE_ROLES = ROLE_REGISTRY.filter((r) => !r.isSystem);

/** Hireable roles as {value, label} pairs for dropdowns. */
export const ROLE_OPTIONS = HIREABLE_ROLES.map((r) => ({
  value: r.slug,
  label: r.label,
}));

/** Flat Record for quick label lookup (includes system roles). */
export const ROLE_LABELS: Record<string, string> = Object.fromEntries(_ROLE_LABELS_MAP);
