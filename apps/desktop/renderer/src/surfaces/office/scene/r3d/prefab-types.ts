/** Minimal prefab definition shape the 3D dispatcher needs (subset of the
 *  legacy shared-types PrefabDefinition). */
type SemanticCategory =
  | 'workspace'
  | 'compute'
  | 'knowledge'
  | 'collaboration'
  | 'infrastructure'
  | 'decorative';

export interface PrefabDefinition {
  prefabId: string;
  category: SemanticCategory;
  render2D?: { template?: string };
}
