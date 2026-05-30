export interface PrefabStateChangedPayload {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly prev: string;
  readonly next: string;
}
