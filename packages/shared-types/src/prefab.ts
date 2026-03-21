// ── Prefab System Type Definitions ──────────────────────────────

export type SemanticCategory =
  | 'workspace'
  | 'compute'
  | 'knowledge'
  | 'collaboration'
  | 'infrastructure'
  | 'decorative';

export type PrefabBindingSlotType =
  | 'agent-context'
  | 'model-endpoint'
  | 'rack-provider'
  | 'knowledge-source'
  | 'meeting-session'
  | 'handoff-route';

export interface PrefabBindingSlotDef {
  readonly name: string;
  readonly type: PrefabBindingSlotType;
  readonly required: boolean;
}

export interface RenderTemplate2D {
  readonly template: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface PrefabChildDef {
  readonly render2D: RenderTemplate2D;
  readonly offset: readonly [number, number];
}

export interface PrefabDefinition {
  readonly prefabId: string;
  readonly name: string;
  readonly description: string;
  readonly category: SemanticCategory;
  readonly gridSize: readonly [number, number];
  readonly composite: boolean;
  readonly children?: readonly PrefabChildDef[];
  readonly render2D?: RenderTemplate2D;
  readonly bindingSlots: readonly PrefabBindingSlotDef[];
  readonly sourcePackageId?: string | null;
}

export interface PrefabInstanceRow {
  readonly instance_id: string;
  readonly company_id: string;
  readonly prefab_id: string;
  readonly zone_id: string;
  readonly position_x: number;
  readonly position_y: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly bindings_json: string | null;
  readonly config_json: string | null;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PrefabBinding {
  readonly slotName: string;
  readonly resourceRef: string;
  readonly label?: string;
}
