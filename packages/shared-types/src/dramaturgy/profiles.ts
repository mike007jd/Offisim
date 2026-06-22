/**
 * Company + employee performance profiles (Phase 5, source plan §10).
 *
 * Profiles bias *presentation only* — which variant, how expressive, how fast,
 * which affordances an actor prefers. They never enter the Pi prompt or Harness
 * execution and never change facts, actors, status, or run relations; the beat
 * SET is identical with or without a profile. Employee profiles default from the
 * role family, so user-created employees need no hand-authored choreography.
 */
import type { RoleSlug } from '../roles.js';
import type { InteractionAnchorKind } from './staging.js';

export type CompanyFamily =
  | 'engineering'
  | 'editorial'
  | 'product'
  | 'agency'
  | 'ai-lab'
  | 'generic';

export type CompanyPace = 'deliberate' | 'balanced' | 'fast';
export type CollaborationBias = 'solo' | 'pair' | 'group' | 'mixed';

export interface CompanyPerformanceProfile {
  readonly family: CompanyFamily;
  readonly pace: CompanyPace;
  readonly collaborationBias: CollaborationBias;
  /** Per-motif presentation weights (bias, not facts). Empty = neutral. */
  readonly motifWeights: Readonly<Record<string, number>>;
}

export const DEFAULT_COMPANY_PERFORMANCE: CompanyPerformanceProfile = {
  family: 'generic',
  pace: 'balanced',
  collaborationBias: 'mixed',
  motifWeights: {},
};

export type EmployeeArchetype =
  | 'builder'
  | 'researcher'
  | 'reviewer'
  | 'coordinator'
  | 'creative'
  | 'analyst';

export interface EmployeePerformanceProfile {
  readonly archetype: EmployeeArchetype;
  /** Animation tempo multiplier (renderer-side). */
  readonly tempo: 0.8 | 1 | 1.2;
  /** Gesture amplitude / variety (renderer-side). */
  readonly expressiveness: 0 | 1 | 2;
  readonly socialStyle: 'quiet' | 'balanced' | 'outgoing';
  readonly preferredAffordances?: readonly InteractionAnchorKind[];
}

const ARCHETYPE_BY_ROLE: Readonly<Record<RoleSlug, EmployeeArchetype>> = {
  boss: 'coordinator',
  hr: 'coordinator',
  manager: 'coordinator',
  product_manager: 'coordinator',
  project_manager: 'coordinator',
  account_manager: 'coordinator',
  engineering_manager: 'coordinator',
  yolo_master: 'builder',
  developer: 'builder',
  engineer: 'builder',
  backend: 'builder',
  frontend: 'builder',
  fullstack: 'builder',
  data_engineer: 'builder',
  devops: 'builder',
  designer: 'creative',
  artist: 'creative',
  ui_designer: 'creative',
  ux_designer: 'creative',
  graphic_designer: 'creative',
  writer: 'creative',
  marketer: 'creative',
  seo_specialist: 'analyst',
  pm: 'coordinator',
  analyst: 'analyst',
  researcher: 'researcher',
  qa: 'reviewer',
};

const PROFILE_BY_ARCHETYPE: Readonly<Record<EmployeeArchetype, EmployeePerformanceProfile>> = {
  builder: { archetype: 'builder', tempo: 1, expressiveness: 1, socialStyle: 'balanced', preferredAffordances: ['workstation'] },
  researcher: { archetype: 'researcher', tempo: 0.8, expressiveness: 0, socialStyle: 'quiet', preferredAffordances: ['reading-seat'] },
  reviewer: { archetype: 'reviewer', tempo: 1, expressiveness: 1, socialStyle: 'balanced', preferredAffordances: ['standing-review'] },
  coordinator: { archetype: 'coordinator', tempo: 1.2, expressiveness: 2, socialStyle: 'outgoing', preferredAffordances: ['meeting-seat', 'board-presenter'] },
  creative: { archetype: 'creative', tempo: 1.2, expressiveness: 2, socialStyle: 'balanced', preferredAffordances: ['workstation'] },
  analyst: { archetype: 'analyst', tempo: 0.8, expressiveness: 1, socialStyle: 'quiet', preferredAffordances: ['workstation'] },
};

/** Derive an employee's default performance profile from their role family. */
export function defaultEmployeePerformanceProfile(role: RoleSlug): EmployeePerformanceProfile {
  return PROFILE_BY_ARCHETYPE[ARCHETYPE_BY_ROLE[role] ?? 'builder'];
}
