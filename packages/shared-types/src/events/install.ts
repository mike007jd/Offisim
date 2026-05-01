import type { BindingStatus, BindingType } from '../install.js';
import type { InstallState } from '../states.js';

export interface InstallStatePayload {
  readonly installTxnId: string;
  readonly prev: InstallState;
  readonly next: InstallState;
  readonly packageId?: string;
  readonly errorCode?: string;
}

export interface BindingStatePayload {
  readonly bindingId: string;
  readonly installTxnId: string;
  readonly bindingType: BindingType;
  readonly bindingKey: string;
  readonly prev: BindingStatus;
  readonly next: BindingStatus;
}

/**
 * Emitted when a Market listing install reaches its terminal `installed`
 * state for the active company. Drives Market UI refresh of per-company
 * installed state. Distinct from `InstallStatePayload`, which tracks install
 * transaction state machine transitions; this carries the listing reference
 * the Market UI needs without requiring a reverse lookup through
 * `installedPackages`.
 */
export interface MarketListingInstalledPayload {
  readonly listingId: string;
  readonly kind: 'employee' | 'skill';
  readonly installedPackageId?: string;
  readonly skillId?: string;
}

export const SKILL_INSTALL_OUTCOME = 'skill.install.outcome' as const;

/**
 * Typed outcome returned by the skill install committer. SSOT lives here so
 * the event payload (`SkillInstallOutcomePayload`) and the core handler
 * contract (`SkillInstallConfirmOutcome` in `@offisim/core`) share one
 * definition; core re-exports this as `SkillInstallConfirmOutcome` to keep
 * its public name stable. `skillSlug` is required on success variants so
 * downstream chat / activity surfaces can show it without an async DB
 * roundtrip — the committer always has it when the row is written.
 */
export type SkillInstallOutcomeKind =
  | {
      readonly kind: 'installed';
      readonly skillId: string;
      readonly skillSlug: string;
      readonly wasExisting: boolean;
    }
  | {
      readonly kind: 'created';
      readonly skillId: string;
      readonly skillSlug: string;
      readonly wasExisting: boolean;
    }
  | { readonly kind: 'edited'; readonly skillId: string; readonly skillSlug: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'staging-expired' }
  | { readonly kind: 'error'; readonly errorKind: string; readonly message: string };

export type SkillInstallOutcomePayload = SkillInstallOutcomeKind & {
  readonly interactionId: string;
};

const SKILL_OUTCOME_ERROR_MAX = 120;

function truncateLabel(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Single source of truth for skill install outcome chat copy. Consumed by
 * both the activity rail (ui-office) and the chat assistant message surface
 * (`interaction-follow-up.ts`). Slug comes from the outcome itself
 * (`payload.skillSlug`); when `kind` has no slug, the no-slug fallback runs.
 */
export function skillInstallOutcomeLabel(outcome: SkillInstallOutcomeKind): string {
  switch (outcome.kind) {
    case 'installed':
      return `Skill ${outcome.skillSlug} installed.`;
    case 'created':
      return `Skill ${outcome.skillSlug} created from scratch.`;
    case 'edited':
      return 'Skill body updated.';
    case 'cancelled':
      return 'Skill action cancelled.';
    case 'staging-expired':
      return 'Skill staging timed out — try again.';
    case 'error':
      return `Skill action failed: ${outcome.errorKind}: ${truncateLabel(outcome.message, SKILL_OUTCOME_ERROR_MAX)}`;
  }
}
