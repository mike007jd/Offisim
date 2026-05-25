/**
 * Prefab3D — Data-driven 3D furniture renderer.
 *
 * Maps a PrefabDefinition's category (and optionally its prefabId/template)
 * to the correct extracted Three.js mesh component. This is the single
 * dispatch point: usePrefabInstances provides the data, Prefab3D renders it.
 */

import type { PrefabDefinition } from '../prefab-types.js';
import { SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';
import { BookshelfMesh3D } from './BookshelfMesh3D.js';
import { DecorativeMesh3D } from './DecorativeMesh3D.js';
import { InfrastructureMesh3D } from './InfrastructureMesh3D.js';
import { MeetingTableMesh3D } from './MeetingTableMesh3D.js';
import { RestAreaMesh3D } from './RestAreaMesh3D.js';
import { ServerRackMesh3D, ServerRackUnit3D } from './ServerRackMesh3D.js';
import { WhiteboardMesh3D } from './WhiteboardMesh3D.js';
import { WorkstationMesh3D, WorkstationUnit3D } from './WorkstationMesh3D.js';

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
export function Prefab3D({ definition, position = [0, 0, 0], rotation = 0, state }: Prefab3DProps) {
  const sc = useSceneColors();
  const prefabId = definition.prefabId;
  const template = definition.render2D?.template ?? prefabId;

  if (prefabId === 'sofa-set') {
    return <RestAreaMesh3D position={position} rotation={rotation} state={state} />;
  }
  if (
    prefabId === 'coffee-table' ||
    prefabId === 'vending-machine' ||
    prefabId === 'water-cooler' ||
    prefabId === 'chair-standalone' ||
    prefabId === 'status-board'
  ) {
    return (
      <DecorativeMesh3D position={position} rotation={rotation} state={state} template={prefabId} />
    );
  }
  if (prefabId === 'reading-table') {
    return (
      <BookshelfMesh3D
        position={position}
        rotation={rotation}
        state={state}
        template="reading-table"
      />
    );
  }
  if (
    prefabId === 'bookshelf-single' ||
    prefabId === 'bookshelf-double' ||
    prefabId === 'filing-cabinet'
  ) {
    return (
      <BookshelfMesh3D position={position} rotation={rotation} state={state} template={prefabId} />
    );
  }
  if (prefabId === 'whiteboard') {
    return <WhiteboardMesh3D position={position} rotation={rotation} state={state} />;
  }
  if (prefabId === 'standing-table') {
    return (
      <MeetingTableMesh3D
        position={position}
        rotation={rotation}
        capacity={4}
        state={state}
        variant="standing"
      />
    );
  }
  if (prefabId === 'network-switch' || prefabId === 'cable-tray' || prefabId === 'patch-panel') {
    return (
      <InfrastructureMesh3D
        position={position}
        rotation={rotation}
        state={state}
        template={prefabId}
      />
    );
  }

  switch (definition.category) {
    case 'workspace':
      if (prefabId === 'workstation-compact') {
        return (
          <WorkstationUnit3D
            position={position}
            rotation={rotation}
            variant="compact"
            state={state}
          />
        );
      }
      if (prefabId === 'workstation-dual') {
        return (
          <WorkstationUnit3D position={position} rotation={rotation} variant="dual" state={state} />
        );
      }
      if (prefabId === 'workstation-standard') {
        return <WorkstationUnit3D position={position} rotation={rotation} state={state} />;
      }
      return <WorkstationMesh3D position={position} rotation={rotation} state={state} />;

    case 'compute':
      if (prefabId === 'server-rack-4u') {
        return (
          <ServerRackUnit3D
            position={position}
            rotation={rotation}
            heightScale={1.24}
            state={state}
          />
        );
      }
      if (prefabId === 'server-rack-2u') {
        return <ServerRackUnit3D position={position} rotation={rotation} state={state} />;
      }
      if (prefabId === 'gpu-cluster') {
        return (
          <group position={position} rotation={[0, (rotation * Math.PI) / 180, 0]}>
            <group scale={[0.94, 1, 0.94]}>
              <ServerRackUnit3D position={[-0.95, 0, 0]} state={state} />
              <ServerRackUnit3D position={[0, 0, 0]} heightScale={1.12} state={state} />
              <ServerRackUnit3D position={[0.95, 0, 0]} state={state} />
            </group>
          </group>
        );
      }
      return <ServerRackMesh3D position={position} rotation={rotation} state={state} />;

    case 'knowledge':
      return <BookshelfMesh3D position={position} rotation={rotation} state={state} />;

    case 'collaboration':
      if (prefabId === 'meeting-table-4') {
        return (
          <MeetingTableMesh3D position={position} rotation={rotation} capacity={4} state={state} />
        );
      }
      return <MeetingTableMesh3D position={position} rotation={rotation} state={state} />;

    case 'infrastructure':
      return (
        <InfrastructureMesh3D
          position={position}
          rotation={rotation}
          state={state}
          template={template}
        />
      );

    case 'decorative':
      return (
        <DecorativeMesh3D
          position={position}
          rotation={rotation}
          state={state}
          template={prefabId === 'plant-small' || prefabId === 'plant-large' ? prefabId : template}
        />
      );

    default:
      // Unknown category — render a gray placeholder cube
      return (
        <group position={position} rotation={[0, (rotation * Math.PI) / 180, 0]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <SceneMaterial materialClass="plastic" color={sc.textMuted} />
          </mesh>
        </group>
      );
  }
}
