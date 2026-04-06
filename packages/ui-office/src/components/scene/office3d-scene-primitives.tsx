import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { AgentState } from '../../runtime/use-agent-states';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import type { DragState3D, FlowLineData } from './office3d-shared.js';

const ROOM_W = 40;
const ROOM_D = 30;
const WALL_H = 5;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const intersectPoint = new THREE.Vector3();
const htmlProjectPoint = new THREE.Vector3();
const HTML_LABEL_HALF_WIDTH = 92;
const HTML_LABEL_MARGIN = 18;

function createInsetAwareHtmlPosition(leftInset: number, rightInset: number) {
  return (el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }) => {
    htmlProjectPoint.setFromMatrixPosition(el.matrixWorld).project(camera);
    const projectedX = (htmlProjectPoint.x * 0.5 + 0.5) * size.width;
    const projectedY = (htmlProjectPoint.y * -0.5 + 0.5) * size.height;
    const minX = leftInset + HTML_LABEL_HALF_WIDTH + HTML_LABEL_MARGIN;
    const maxX = size.width - rightInset - HTML_LABEL_HALF_WIDTH - HTML_LABEL_MARGIN;
    const clampedX = minX <= maxX ? THREE.MathUtils.clamp(projectedX, minX, maxX) : size.width / 2;
    return [clampedX, THREE.MathUtils.clamp(projectedY, 20, size.height - 20)];
  };
}

export function ZoneLabel({
  position,
  size,
  color,
  name,
  isDragging,
  isHovered,
  isSource,
  activityCount,
  hasBlocked,
  isMeetingActive,
  viewportInsets,
}: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  name: string;
  isDragging?: boolean;
  isHovered?: boolean;
  isSource?: boolean;
  activityCount?: number;
  hasBlocked?: boolean;
  isMeetingActive?: boolean;
  viewportInsets: {
    left: number;
    right: number;
  };
}) {
  const floorOpacity = isDragging ? (isHovered && !isSource ? 0.35 : isSource ? 0.08 : 0.2) : 0.12;
  const borderOpacity = isDragging ? (isHovered && !isSource ? 0.9 : isSource ? 0.3 : 0.6) : 0.4;

  const edgePlaneGeo = useMemo(() => new THREE.PlaneGeometry(size[0], size[1]), [size[0], size[1]]);
  const htmlPosition = useMemo(
    () => createInsetAwareHtmlPosition(viewportInsets.left, viewportInsets.right),
    [viewportInsets.left, viewportInsets.right],
  );
  useEffect(() => () => edgePlaneGeo.dispose(), [edgePlaneGeo]);

  return (
    <group position={position}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={floorOpacity} />
        <lineSegments>
          <edgesGeometry args={[edgePlaneGeo]} />
          <lineBasicMaterial color={color} transparent opacity={borderOpacity} />
        </lineSegments>
      </mesh>
      {!isDragging && (
        <ZoneActivityGlow
          size={size}
          activityCount={activityCount ?? 0}
          hasBlocked={hasBlocked ?? false}
        />
      )}
      {isMeetingActive && <MeetingActiveLabel />}
      {isDragging && !isSource && (
        <Html
          position={[0, 0.8, 0]}
          center
          style={{ pointerEvents: 'none' }}
          calculatePosition={htmlPosition}
        >
          <div
            style={{
              background: isHovered ? 'rgba(30,64,175,0.85)' : 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${isHovered ? '#60a5fa' : `${color}40`}`,
              borderRadius: '8px',
              padding: '4px 14px',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            <span
              style={{
                color: isHovered ? '#ffffff' : color,
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              Drop here
            </span>
          </div>
        </Html>
      )}
      <Html
        position={[0, 0.5, -size[1] / 2 + 0.5]}
        center
        style={{ pointerEvents: 'none' }}
        calculatePosition={htmlPosition}
      >
        <div
          data-zone-label={name}
          style={{
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${color}40`,
            borderRadius: '8px',
            padding: '4px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              color,
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '3px',
              textTransform: 'uppercase',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            {name}
          </span>
        </div>
      </Html>
    </group>
  );
}

export function RoomShell({ onFloorClick }: { onFloorClick?: () => void }) {
  return (
    <group>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: react-three-fiber meshes are not keyboard-focusable DOM nodes. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={() => onFloorClick?.()}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#020617" roughness={0.9} />
      </mesh>
      <gridHelper args={[ROOM_W, 40, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
      <mesh position={[0, WALL_H / 2, -ROOM_D / 2]} receiveShadow>
        <boxGeometry args={[ROOM_W, WALL_H, 0.3]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[-ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
    </group>
  );
}

export function DragGhost3D({ position }: { position: [number, number, number] }) {
  const sc = useSceneColors();
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.3, 1.2, 12]} />
        <meshStandardMaterial color={sc.selectionRing} transparent opacity={0.45} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color={sc.selectionRing} transparent opacity={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

export function DragController({
  dragState,
  onDragMove,
  onDragEnd,
  onDragCancel,
  controlsRef,
}: {
  dragState: DragState3D | null;
  onDragMove: (worldX: number, worldZ: number, screenX: number, screenY: number) => void;
  onDragEnd: (worldX: number, worldZ: number) => void;
  onDragCancel: () => void;
  controlsRef: React.RefObject<{ enabled: boolean } | null>;
}) {
  const { camera, gl } = useThree();

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onDragCancelRef = useRef(onDragCancel);
  onDragCancelRef.current = onDragCancel;

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.enabled = !dragState;
  }, [dragState, controlsRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragStateRef.current) {
        onDragCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLeave = () => {
      if (dragStateRef.current) onDragCancelRef.current();
    };
    canvas.addEventListener('pointerleave', handleLeave);
    return () => canvas.removeEventListener('pointerleave', handleLeave);
  }, [gl.domElement]);

  const raycastToFloor = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(floorPlane, intersectPoint);
      if (!hit) return null;
      return [intersectPoint.x, 0, intersectPoint.z];
    },
    [camera, gl.domElement],
  );

  useEffect(() => {
    const canvas = gl.domElement;

    const handleMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const position = raycastToFloor(event.clientX, event.clientY);
      if (position) {
        onDragMoveRef.current(position[0], position[2], event.clientX, event.clientY);
      }
    };

    const handleUp = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const position = raycastToFloor(event.clientX, event.clientY);
      if (position) {
        onDragEndRef.current(position[0], position[2]);
      } else {
        onDragCancelRef.current();
      }
    };

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerup', handleUp);
    };
  }, [gl.domElement, raycastToFloor]);

  return null;
}

export function TaskFlowLine({
  points,
  color,
  onComplete,
}: {
  points: FlowLineData['points'];
  color: string;
  onComplete: () => void;
}) {
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const startRef = useRef(performance.now() / 1000);
  const doneRef = useRef(false);

  const vectors = useMemo(() => points.map((point) => new THREE.Vector3(...point)), [points]);
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(vectors), [vectors]);
  const lineObject = useMemo(() => {
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      linewidth: 2,
    });
    return new THREE.Line(geometry, material);
  }, [geometry, color]);

  useFrame(() => {
    if (doneRef.current || !matRef.current) return;
    const elapsed = performance.now() / 1000 - startRef.current;
    let opacity = 0;
    if (elapsed < 0.3) {
      opacity = elapsed / 0.3;
    } else if (elapsed < 1.3) {
      opacity = 1;
    } else if (elapsed < 2.0) {
      opacity = 1 - (elapsed - 1.3) / 0.7;
    } else {
      doneRef.current = true;
      onComplete();
      return;
    }
    matRef.current.opacity = opacity * 0.85;
  });

  useEffect(() => {
    if (!matRef.current) {
      matRef.current = lineObject.material as THREE.LineBasicMaterial;
    }
  }, [lineObject]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      (lineObject.material as THREE.LineBasicMaterial).dispose();
    };
  }, [geometry, lineObject]);

  return <primitive object={lineObject} />;
}

export function MeetingParticipantLines({
  participantPositions,
}: {
  participantPositions: [number, number, number][];
}) {
  const sc = useSceneColors();
  const meetingCenter: [number, number, number] = [-10, 0.5, -8];
  const previousLinesRef = useRef<THREE.Line[]>([]);

  const lines = useMemo(() => {
    for (const line of previousLinesRef.current) {
      line.geometry.dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
    }

    const nextLines = participantPositions.map((position) => {
      const points = [new THREE.Vector3(...meetingCenter), new THREE.Vector3(...position)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: sc.textMuted,
        transparent: true,
        opacity: 0.35,
        linewidth: 1,
      });
      return new THREE.Line(geometry, material);
    });

    previousLinesRef.current = nextLines;
    return nextLines;
  }, [participantPositions, sc.textMuted]);

  useEffect(() => {
    return () => {
      for (const line of previousLinesRef.current) {
        line.geometry.dispose();
        (line.material as THREE.LineBasicMaterial).dispose();
      }
    };
  }, []);

  return (
    <>
      {lines.map((line) => (
        <primitive key={line.uuid} object={line} />
      ))}
    </>
  );
}

export function AmbientStateLight({ agents }: { agents: Map<string, AgentState> }) {
  const lightRef = useRef<THREE.AmbientLight>(null);

  const { targetColor, targetIntensity } = useMemo(() => {
    const values = [...agents.values()];
    const hasBlocked = values.some(
      (agent) => agent.state === 'blocked' || agent.state === 'failed',
    );
    const hasActive = values.some((agent) => agent.state !== 'idle');
    const hasMeeting = values.some((agent) => agent.state === 'meeting');
    const color = hasBlocked
      ? '#ff9944'
      : hasMeeting
        ? '#c4bfee'
        : hasActive
          ? '#ffffff'
          : '#aabbcc';
    return { targetColor: color, targetIntensity: hasMeeting ? 0.6 : 0.8 };
  }, [agents]);

  const targetColorObject = useMemo(() => new THREE.Color(targetColor), [targetColor]);

  useFrame(() => {
    if (!lightRef.current) return;
    lightRef.current.color.lerp(targetColorObject, 0.02);
    lightRef.current.intensity = THREE.MathUtils.lerp(
      lightRef.current.intensity,
      targetIntensity,
      0.02,
    );
  });

  return <ambientLight ref={lightRef} intensity={0.8} color={targetColor} />;
}

function ZoneActivityGlow({
  size,
  activityCount,
  hasBlocked,
}: {
  size: [number, number];
  activityCount: number;
  hasBlocked: boolean;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const targetOpacity = hasBlocked
    ? 0.18
    : activityCount >= 3
      ? 0.2
      : activityCount >= 1
        ? 0.1
        : 0.04;
  const baseColor = hasBlocked ? '#f59e0b' : '#60a5fa';

  useFrame((state) => {
    if (!matRef.current) return;
    const pulse = Math.sin(state.clock.elapsedTime * 2.5) * 0.2 + 1;
    matRef.current.opacity = targetOpacity * pulse;
  });

  return (
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial ref={matRef} color={baseColor} transparent opacity={targetOpacity} />
    </mesh>
  );
}

function MeetingActiveLabel() {
  const sc = useSceneColors();
  return (
    <Html position={[0, 2.5, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: 'rgba(148,163,184,0.20)',
          backdropFilter: 'blur(6px)',
          border: `1px solid ${sc.textMuted}`,
          borderRadius: '9999px',
          padding: '3px 14px',
          whiteSpace: 'nowrap',
          animation: 'pulse 2s infinite',
        }}
      >
        <span
          style={{
            color: sc.text,
            fontSize: '10px',
            fontWeight: 900,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          MEETING
        </span>
      </div>
    </Html>
  );
}
