export interface PrefabStateChangedPayload {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly category: string;
  readonly prev: string;
  readonly next: string;
}
