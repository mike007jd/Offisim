/**
 * Built-in Prefab Catalog
 *
 * Pure data definitions for all built-in PrefabDefinition objects.
 * No PixiJS dependency -- template names reference entries registered
 * in render-templates.ts but this module only stores the string key.
 *
 * Every definition is Object.freeze'd for immutability.
 */
import type {
  PrefabBindingSlotDef,
  PrefabChildDef,
  PrefabDefinition,
  RenderTemplate2D,
  SemanticCategory,
} from '@offisim/shared-types';

// ── Helpers ─────────────────────────────────────────────────────

function tpl(template: string, params: Record<string, unknown> = {}): RenderTemplate2D {
  return Object.freeze({ template, params: Object.freeze(params) });
}

function child(render2D: RenderTemplate2D, offset: [number, number]): PrefabChildDef {
  return Object.freeze({ render2D, offset: Object.freeze(offset) as readonly [number, number] });
}

function slot(
  name: string,
  type: PrefabBindingSlotDef['type'],
  required: boolean,
): PrefabBindingSlotDef {
  return Object.freeze({ name, type, required });
}

function def(d: PrefabDefinition): PrefabDefinition {
  return Object.freeze(d);
}

// ── Workspace ───────────────────────────────────────────────────

const workstationStandard = def({
  prefabId: 'workstation-standard',
  name: 'Standard Workstation',
  description: 'Desk, monitor, and chair — the default employee workspace.',
  category: 'workspace',
  gridSize: Object.freeze([2, 2]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('desk'), [0, 0]),
    child(tpl('monitor'), [0, -12]),
    child(tpl('chair'), [0, 14]),
  ]),
  bindingSlots: Object.freeze([slot('agent-context', 'agent-context', true)]),
});

const workstationCompact = def({
  prefabId: 'workstation-compact',
  name: 'Compact Workstation',
  description: 'Space-saving desk and monitor without chair.',
  category: 'workspace',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('desk', { width: 35, height: 22 }), [0, 0]),
    child(tpl('monitor'), [0, -10]),
  ]),
  bindingSlots: Object.freeze([slot('agent-context', 'agent-context', true)]),
});

const workstationDual = def({
  prefabId: 'workstation-dual',
  name: 'Dual-Monitor Workstation',
  description: 'Desk with two monitors and a chair — for heavy multitaskers.',
  category: 'workspace',
  gridSize: Object.freeze([2, 2]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('desk'), [0, 0]),
    child(tpl('monitor'), [-8, -12]),
    child(tpl('monitor'), [8, -12]),
    child(tpl('chair'), [0, 14]),
  ]),
  bindingSlots: Object.freeze([slot('agent-context', 'agent-context', true)]),
});

// ── Compute ─────────────────────────────────────────────────────

const serverRack2U = def({
  prefabId: 'server-rack-2u',
  name: '2U Server Rack',
  description: 'Standard 2-unit server rack for model hosting.',
  category: 'compute',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('server-rack'),
  bindingSlots: Object.freeze([slot('rack-provider', 'rack-provider', true)]),
});

const serverRack4U = def({
  prefabId: 'server-rack-4u',
  name: '4U Server Rack',
  description: 'Tall 4-unit rack for demanding workloads.',
  category: 'compute',
  gridSize: Object.freeze([1, 3]) as readonly [number, number],
  composite: false,
  render2D: tpl('server-rack', { height: 48 }),
  bindingSlots: Object.freeze([slot('rack-provider', 'rack-provider', true)]),
});

const gpuCluster = def({
  prefabId: 'gpu-cluster',
  name: 'GPU Cluster',
  description: 'Three-rack GPU cluster for large model inference.',
  category: 'compute',
  gridSize: Object.freeze([3, 2]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('server-rack'), [-22, 0]),
    child(tpl('server-rack'), [0, 0]),
    child(tpl('server-rack'), [22, 0]),
  ]),
  bindingSlots: Object.freeze([
    slot('rack-provider', 'rack-provider', true),
    slot('model-endpoint', 'model-endpoint', false),
  ]),
});

// ── Knowledge ───────────────────────────────────────────────────

const bookshelfSingle = def({
  prefabId: 'bookshelf-single',
  name: 'Single Bookshelf',
  description: 'A narrow bookshelf for a focused knowledge domain.',
  category: 'knowledge',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('bookshelf', { width: 30, height: 40 }),
  bindingSlots: Object.freeze([slot('knowledge-source', 'knowledge-source', true)]),
});

const bookshelfDouble = def({
  prefabId: 'bookshelf-double',
  name: 'Double Bookshelf',
  description: 'Wide bookshelf for a broad knowledge library.',
  category: 'knowledge',
  gridSize: Object.freeze([2, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('bookshelf', { width: 60, height: 40 }),
  bindingSlots: Object.freeze([slot('knowledge-source', 'knowledge-source', true)]),
});

const filingCabinet = def({
  prefabId: 'filing-cabinet',
  name: 'Filing Cabinet',
  description: 'Compact document storage unit.',
  category: 'knowledge',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('filing-cabinet'),
  bindingSlots: Object.freeze([slot('knowledge-source', 'knowledge-source', true)]),
});

const whiteboard = def({
  prefabId: 'whiteboard',
  name: 'Whiteboard',
  description: 'A wall-mounted whiteboard for brainstorming.',
  category: 'knowledge',
  gridSize: Object.freeze([2, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('whiteboard'),
  bindingSlots: Object.freeze([slot('knowledge-source', 'knowledge-source', false)]),
});

// ── Collaboration ───────────────────────────────────────────────

const meetingTable4 = def({
  prefabId: 'meeting-table-4',
  name: 'Meeting Table (4 seats)',
  description: 'Small meeting table with four chairs.',
  category: 'collaboration',
  gridSize: Object.freeze([3, 3]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('meeting-table', { width: 60, height: 40 }), [0, 0]),
    child(tpl('chair'), [-20, 0]), // left
    child(tpl('chair'), [20, 0]), // right
    child(tpl('chair'), [0, -22]), // top
    child(tpl('chair'), [0, 22]), // bottom
  ]),
  bindingSlots: Object.freeze([slot('meeting-session', 'meeting-session', false)]),
});

const meetingTable8 = def({
  prefabId: 'meeting-table-8',
  name: 'Meeting Table (8 seats)',
  description: 'Large conference table with eight chairs.',
  category: 'collaboration',
  gridSize: Object.freeze([4, 4]) as readonly [number, number],
  composite: true,
  children: Object.freeze([
    child(tpl('meeting-table', { width: 100, height: 60 }), [0, 0]),
    child(tpl('chair'), [-40, -12]), // left-top
    child(tpl('chair'), [-40, 12]), // left-bottom
    child(tpl('chair'), [40, -12]), // right-top
    child(tpl('chair'), [40, 12]), // right-bottom
    child(tpl('chair'), [-14, -32]), // top-left
    child(tpl('chair'), [14, -32]), // top-right
    child(tpl('chair'), [-14, 32]), // bottom-left
    child(tpl('chair'), [14, 32]), // bottom-right
  ]),
  bindingSlots: Object.freeze([slot('meeting-session', 'meeting-session', false)]),
});

const sofaSet = def({
  prefabId: 'sofa-set',
  name: 'Sofa Set',
  description: 'Lounge seating for rest-area breaks.',
  category: 'decorative',
  gridSize: Object.freeze([3, 2]) as readonly [number, number],
  composite: true,
  children: Object.freeze([child(tpl('sofa'), [0, -8]), child(tpl('coffee-table'), [0, 14])]),
  bindingSlots: Object.freeze([]),
});

const standingTable = def({
  prefabId: 'standing-table',
  name: 'Standing Table',
  description: 'High table for quick stand-up meetings.',
  category: 'collaboration',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('standing-table'),
  bindingSlots: Object.freeze([slot('meeting-session', 'meeting-session', false)]),
});

// ── Infrastructure ──────────────────────────────────────────────

const networkSwitch = def({
  prefabId: 'network-switch',
  name: 'Network Switch',
  description: 'Manages handoff routing between agents.',
  category: 'infrastructure',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('network-switch'),
  bindingSlots: Object.freeze([slot('handoff-route', 'handoff-route', true)]),
});

const cableTray = def({
  prefabId: 'cable-tray',
  name: 'Cable Tray',
  description: 'Horizontal cable management run.',
  category: 'infrastructure',
  gridSize: Object.freeze([4, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('cable-tray'),
  bindingSlots: Object.freeze([slot('handoff-route', 'handoff-route', false)]),
});

const patchPanel = def({
  prefabId: 'patch-panel',
  name: 'Patch Panel',
  description: 'Central patch point for route connections.',
  category: 'infrastructure',
  gridSize: Object.freeze([2, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('patch-panel'),
  bindingSlots: Object.freeze([slot('handoff-route', 'handoff-route', true)]),
});

// ── Decorative (no bindings) ────────────────────────────────────

const plantSmall = def({
  prefabId: 'plant-small',
  name: 'Small Plant',
  description: 'A potted desk plant for ambiance.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('plant'),
  bindingSlots: Object.freeze([]),
});

const plantLarge = def({
  prefabId: 'plant-large',
  name: 'Large Plant',
  description: 'A tall floor plant for corners and open areas.',
  category: 'decorative',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('plant', { width: 20, height: 30 }),
  bindingSlots: Object.freeze([]),
});

const coffeeTableDeco = def({
  prefabId: 'coffee-table',
  name: 'Coffee Table',
  description: 'Low table for a break area.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('coffee-table'),
  bindingSlots: Object.freeze([]),
});

const vendingMachine = def({
  prefabId: 'vending-machine',
  name: 'Vending Machine',
  description: 'Dispenses refreshments in the rest area.',
  category: 'decorative',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('vending-machine'),
  bindingSlots: Object.freeze([]),
});

const waterCooler = def({
  prefabId: 'water-cooler',
  name: 'Water Cooler',
  description: 'Hydration station — the classic office gathering spot.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  // Simple circle — no named template, rendered inline
  render2D: tpl('water-cooler'),
  bindingSlots: Object.freeze([]),
});

const readingTable = def({
  prefabId: 'reading-table',
  name: 'Reading Table',
  description: 'Quiet reading surface for the library zone.',
  category: 'decorative',
  gridSize: Object.freeze([2, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('reading-table'),
  bindingSlots: Object.freeze([]),
});

const chairStandalone = def({
  prefabId: 'chair-standalone',
  name: 'Chair',
  description: 'A standalone chair for flexible seating.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('chair'),
  bindingSlots: Object.freeze([]),
});

const statusBoard = def({
  prefabId: 'status-board',
  name: 'Status Board',
  description: 'Wall-mounted dashboard display for team KPIs.',
  category: 'decorative',
  gridSize: Object.freeze([2, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('whiteboard'),
  bindingSlots: Object.freeze([]),
});

// ── Rest & dining (no bindings) ─────────────────────────────────
// 2D does not draw furniture; render2D reuses the nearest existing template
// key. The 3D meshes dispatch on prefabId in Prefab3D.

const coffeeMachine = def({
  prefabId: 'coffee-machine',
  name: 'Coffee Machine',
  description: 'Countertop espresso machine on a stand — the rest-area caffeine stop.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('water-cooler'),
  bindingSlots: Object.freeze([]),
});

const pantryCounter = def({
  prefabId: 'pantry-counter',
  name: 'Pantry Counter',
  description: 'Low serving counter with a kettle, cup rack, and fruit bowl.',
  category: 'decorative',
  gridSize: Object.freeze([3, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('coffee-table'),
  bindingSlots: Object.freeze([]),
});

const snackShelf = def({
  prefabId: 'snack-shelf',
  name: 'Snack Shelf',
  description: 'Open shelving stocked with colorful snacks.',
  category: 'decorative',
  gridSize: Object.freeze([1, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('bookshelf'),
  bindingSlots: Object.freeze([]),
});

const fridge = def({
  prefabId: 'fridge',
  name: 'Fridge',
  description: 'Rounded single-door refrigerator for the rest area.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('vending-machine'),
  bindingSlots: Object.freeze([]),
});

const diningTable4 = def({
  prefabId: 'dining-table-4',
  name: 'Dining Table (4 seats)',
  description: 'Square warm-wood dining table with four chairs.',
  category: 'decorative',
  gridSize: Object.freeze([3, 3]) as readonly [number, number],
  composite: false,
  render2D: tpl('meeting-table'),
  bindingSlots: Object.freeze([]),
});

const cafeTable2 = def({
  prefabId: 'cafe-table-2',
  name: 'Cafe Table (2 seats)',
  description: 'Small round cafe table with two facing chairs.',
  category: 'decorative',
  gridSize: Object.freeze([2, 2]) as readonly [number, number],
  composite: false,
  render2D: tpl('coffee-table'),
  bindingSlots: Object.freeze([]),
});

const sofaSingle = def({
  prefabId: 'sofa-single',
  name: 'Armchair Sofa',
  description: 'Single-seat armchair sofa in the rest-area visual language.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('sofa'),
  bindingSlots: Object.freeze([]),
});

const loungeBench = def({
  prefabId: 'lounge-bench',
  name: 'Lounge Bench',
  description: 'Padded two-seat bench for informal breaks.',
  category: 'decorative',
  gridSize: Object.freeze([2, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('sofa'),
  bindingSlots: Object.freeze([]),
});

const magazineRack = def({
  prefabId: 'magazine-rack',
  name: 'Magazine Rack',
  description: 'Standing rack with browsable magazines.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('bookshelf'),
  bindingSlots: Object.freeze([]),
});

const floorLamp = def({
  prefabId: 'floor-lamp',
  name: 'Floor Lamp',
  description: 'Free-standing warm floor lamp.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('plant'),
  bindingSlots: Object.freeze([]),
});

const plantMedium = def({
  prefabId: 'plant-medium',
  name: 'Medium Plant',
  description: 'Mid-sized potted plant, between the desk and corner variants.',
  category: 'decorative',
  gridSize: Object.freeze([1, 1]) as readonly [number, number],
  composite: false,
  render2D: tpl('plant'),
  bindingSlots: Object.freeze([]),
});

// ── Catalog index ───────────────────────────────────────────────

const ALL_PREFABS: readonly PrefabDefinition[] = Object.freeze([
  // workspace (3)
  workstationStandard,
  workstationCompact,
  workstationDual,
  // compute (3)
  serverRack2U,
  serverRack4U,
  gpuCluster,
  // knowledge (4)
  bookshelfSingle,
  bookshelfDouble,
  filingCabinet,
  whiteboard,
  // collaboration (4)
  meetingTable4,
  meetingTable8,
  sofaSet,
  standingTable,
  // infrastructure (3)
  networkSwitch,
  cableTray,
  patchPanel,
  // decorative (7)
  plantSmall,
  plantLarge,
  coffeeTableDeco,
  vendingMachine,
  waterCooler,
  readingTable,
  chairStandalone,
  statusBoard,
  // rest & dining (11)
  coffeeMachine,
  pantryCounter,
  snackShelf,
  fridge,
  diningTable4,
  cafeTable2,
  sofaSingle,
  loungeBench,
  magazineRack,
  floorLamp,
  plantMedium,
]);

const PREFAB_INDEX = new Map<string, PrefabDefinition>(ALL_PREFABS.map((p) => [p.prefabId, p]));

// ── Public API ──────────────────────────────────────────────────

/** Look up a single built-in prefab by ID. */
export function getBuiltinPrefab(prefabId: string): PrefabDefinition | undefined {
  return PREFAB_INDEX.get(prefabId);
}

/** Return all built-in prefab definitions. */
export function getAllBuiltinPrefabs(): PrefabDefinition[] {
  return [...ALL_PREFABS];
}

/** Return built-in prefabs filtered by category. */
export function getBuiltinPrefabsByCategory(category: SemanticCategory): PrefabDefinition[] {
  return ALL_PREFABS.filter((p) => p.category === category);
}
