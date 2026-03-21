// Prefab system — barrel export (pure logic, no rendering engine dependency)
export { PrefabEventRouter } from './prefab-event-router.js';
export type { PrefabRuntimeHandle } from './prefab-event-router.js';
export { getBuiltinPrefab, getAllBuiltinPrefabs, getBuiltinPrefabsByCategory } from './builtin-catalog.js';
export { getDefaultZoneLayout } from './default-zone-layouts.js';
export type { DefaultPrefabPlacement } from './default-zone-layouts.js';
export { canTransition, getInitialState, getAllStates, inferWorkspaceState } from './state-machines.js';
