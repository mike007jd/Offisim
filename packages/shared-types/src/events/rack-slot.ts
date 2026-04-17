export interface RackBoundPayload {
  readonly rackId: string;
  readonly providerType: string;
  readonly label: string;
}

export interface RackUnboundPayload {
  readonly rackId: string;
}

export interface SlotAssignedPayload {
  readonly slotId: string;
  readonly rackId: string;
  readonly capabilityName: string;
  readonly exposureScope: string;
}

export interface SlotRemovedPayload {
  readonly slotId: string;
  readonly rackId: string;
}
