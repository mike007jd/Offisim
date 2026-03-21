/**
 * Prefab3D — Data-driven 3D furniture renderer.
 *
 * Maps a PrefabDefinition's category (and optionally its prefabId/template)
 * to the correct extracted Three.js mesh component. This is the single
 * dispatch point: usePrefabInstances provides the data, Prefab3D renders it.
 */

import type { PrefabDefinition } from '@aics/shared-types';
import { WorkstationMesh3D } from './WorkstationMesh3D.js';
import { ServerRackMesh3D } from './ServerRackMesh3D.js';
import { BookshelfMesh3D } from './BookshelfMesh3D.js';
import { MeetingTableMesh3D } from './MeetingTableMesh3D.js';
import { RestAreaMesh3D } from './RestAreaMesh3D.js';
import { InfrastructureMesh3D } from './InfrastructureMesh3D.js';
import { DecorativeMesh3D } from './DecorativeMesh3D.js';

export interface Prefab3DProps {
  definition: PrefabDefinition;
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

/**
 * Renders a Three.js mesh group based on the PrefabDefinition's semantic category.
 *
 * When the prefabId matches a known template (e.g. 'workstation-standard',
 * 'server-rack-2u'), we render the dedicated mesh. For unknown prefabIds we
 * fall back to a category-level default, and for completely unknown categories
 * we render a gray placeholder box.
 */
export function Prefab3D({
  definition,
  position = [0, 0, 0],
  rotation = 0,
  state,
}: Prefab3DProps) {
  const template = definition.render2D?.template ?? definition.prefabId;

  switch (definition.category) {
    case 'workspace':
      return (
        <WorkstationMesh3D
          position={position}
          rotation={rotation}
          state={state}
        />
      );

    case 'compute':
      return (
        <ServerRackMesh3D
          position={position}
          rotation={rotation}
          state={state}
        />
      );

    case 'knowledge':
      return (
        <BookshelfMesh3D
          position={position}
          rotation={rotation}
          state={state}
        />
      );

    case 'collaboration':
      return (
        <MeetingTableMesh3D
          position={position}
          rotation={rotation}
          state={state}
        />
      );

    case 'infrastructure':
      return (
        <InfrastructureMesh3D
          position={position}
          rotation={rotation}
          state={state}
        />
      );

    case 'decorative':
      // Rest area is a composite decorative prefab with its own mesh
      if (template === 'sofa-set') {
        return (
          <RestAreaMesh3D
            position={position}
            rotation={rotation}
            state={state}
          />
        );
      }
      return (
        <DecorativeMesh3D
          position={position}
          rotation={rotation}
          state={state}
          template={template}
        />
      );

    default:
      // Unknown category — render a gray placeholder cube
      return (
        <group position={position} rotation={[0, (rotation * Math.PI) / 180, 0]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#6b7280" />
          </mesh>
        </group>
      );
  }
}
