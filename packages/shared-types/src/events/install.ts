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
  /** Manifest package_id — stable across catalog re-seeds. */
  readonly packageId?: string;
  /** Installed version — together with packageId forms the canonical install identity. */
  readonly version?: string;
}
