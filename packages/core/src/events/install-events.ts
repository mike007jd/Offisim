/**
 * Install pipeline event factories.
 * Extracted from event-factories.ts for domain separation.
 */
import type {
  BindingStatePayload,
  BindingStatus,
  BindingType,
  InstallState,
  InstallStatePayload,
  MarketListingInstalledPayload,
  RuntimeEvent,
} from '@offisim/shared-types';

export function installStateChanged(
  companyId: string,
  installTxnId: string,
  prev: InstallState,
  next: InstallState,
  threadId?: string,
  packageId?: string,
  errorCode?: string,
): RuntimeEvent<InstallStatePayload> {
  return {
    type: 'install.state.changed',
    entityId: installTxnId,
    entityType: 'install',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { installTxnId, prev, next, packageId, errorCode },
  };
}

export function marketListingInstalled(
  companyId: string,
  listingId: string,
  kind: 'employee' | 'skill',
  extras?: {
    installedPackageId?: string;
    skillId?: string;
    threadId?: string;
    packageId?: string;
    version?: string;
  },
): RuntimeEvent<MarketListingInstalledPayload> {
  return {
    type: 'market.listing-installed',
    entityId: listingId,
    entityType: 'install',
    companyId,
    threadId: extras?.threadId,
    timestamp: Date.now(),
    payload: {
      listingId,
      kind,
      ...(extras?.installedPackageId !== undefined
        ? { installedPackageId: extras.installedPackageId }
        : {}),
      ...(extras?.skillId !== undefined ? { skillId: extras.skillId } : {}),
      ...(extras?.packageId !== undefined ? { packageId: extras.packageId } : {}),
      ...(extras?.version !== undefined ? { version: extras.version } : {}),
    },
  };
}

export function bindingStateChanged(
  companyId: string,
  bindingId: string,
  installTxnId: string,
  bindingType: BindingType,
  bindingKey: string,
  prev: BindingStatus,
  next: BindingStatus,
  threadId?: string,
): RuntimeEvent<BindingStatePayload> {
  return {
    type: 'binding.state.changed',
    entityId: bindingId,
    entityType: 'install',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { bindingId, installTxnId, bindingType, bindingKey, prev, next },
  };
}
