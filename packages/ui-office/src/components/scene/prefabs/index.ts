/**
 * Prefab 3D mesh components — barrel export.
 *
 * Data-driven furniture rendering for the Office3DView.
 * Each component maps to a PrefabDefinition semantic category.
 */

export { Prefab3D } from './Prefab3D.js';
export type { Prefab3DProps } from './Prefab3D.js';

export {
  WorkstationMesh3D,
  WorkstationUnit3D,
  WorkSurfaceAccent3D,
  OfficeChair,
  Laptop,
} from './WorkstationMesh3D.js';
export type { WorkstationMesh3DProps, WorkstationUnit3DProps } from './WorkstationMesh3D.js';

export { ServerRackMesh3D, ServerRackUnit3D } from './ServerRackMesh3D.js';
export type { ServerRackMesh3DProps, ServerRackUnit3DProps } from './ServerRackMesh3D.js';

export { BookshelfMesh3D } from './BookshelfMesh3D.js';
export type { BookshelfMesh3DProps } from './BookshelfMesh3D.js';

export { MeetingTableMesh3D } from './MeetingTableMesh3D.js';
export type { MeetingTableMesh3DProps } from './MeetingTableMesh3D.js';

export { RestAreaMesh3D } from './RestAreaMesh3D.js';
export type { RestAreaMesh3DProps } from './RestAreaMesh3D.js';

export {
  NetworkSwitchMesh3D,
  CableTrayMesh3D,
  InfrastructureMesh3D,
} from './InfrastructureMesh3D.js';
export type { InfrastructureMesh3DProps } from './InfrastructureMesh3D.js';

export { PlantMesh3D, DecorativeMesh3D } from './DecorativeMesh3D.js';
export type { DecorativeMesh3DProps, PlantMesh3DProps } from './DecorativeMesh3D.js';
