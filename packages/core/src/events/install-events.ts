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
