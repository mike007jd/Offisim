// Prefab system — barrel export
export { PrefabRuntime } from './prefab-runtime.js';
export { PrefabEventRouter } from './prefab-event-router.js';
export { getBuiltinPrefab, getAllBuiltinPrefabs, getBuiltinPrefabsByCategory } from './builtin-catalog.js';
export { getDefaultZoneLayout } from './default-zone-layouts.js';
export type { DefaultPrefabPlacement } from './default-zone-layouts.js';
export { canTransition, getInitialState, getAllStates, inferWorkspaceState } from './state-machines.js';
export { getTemplate, registerTemplate, buildStateContexts, getAllTemplateNames } from './render-templates.js';
export type { RenderTemplateFn } from './render-templates.js';
