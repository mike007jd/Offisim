export function modeRouter(state: { readonly interactionMode?: string | null }): string {
  switch (state.interactionMode ?? 'boss_proxy') {
    case 'direct_to_employee':
      return 'pm_planner';
    case 'yolo':
      return 'yolo-master';
    default:
      return 'boss';
  }
}
