/**
 * Role → animation tempo.
 *
 * Trimmed to the one field the scene actually reads: the per-role animation speed
 * the 3D character plays its poses at. The company-level performance profile,
 * employee archetype/expressiveness/socialStyle/preferredAffordances, and motif
 * weights were unused scaffolding (no live scene consumer) and were deleted. Add
 * a richer profile back only with a real consumer that lets company/persona style
 * drive variant / anchor / gesture choices.
 */
import type { RoleSlug } from '@offisim/shared-types';

/** Animation speed multiplier per role family (the only profile field the scene
 *  ever consumed). 0.8 = deliberate, 1 = neutral, 1.2 = brisk. */
const TEMPO_BY_ROLE: Readonly<Record<RoleSlug, number>> = {
  boss: 1.2,
  hr: 1.2,
  manager: 1.2,
  product_manager: 1.2,
  project_manager: 1.2,
  account_manager: 1.2,
  engineering_manager: 1.2,
  pm: 1.2,
  yolo_master: 1,
  developer: 1,
  engineer: 1,
  backend: 1,
  frontend: 1,
  fullstack: 1,
  data_engineer: 1,
  devops: 1,
  designer: 1.2,
  artist: 1.2,
  ui_designer: 1.2,
  ux_designer: 1.2,
  graphic_designer: 1.2,
  writer: 1.2,
  marketer: 1.2,
  seo_specialist: 0.8,
  analyst: 0.8,
  researcher: 0.8,
  qa: 1,
};

/** The animation speed the 3D character plays a role's poses at (default 1). */
export function animationTempoForRole(role: RoleSlug): number {
  return TEMPO_BY_ROLE[role] ?? 1;
}
