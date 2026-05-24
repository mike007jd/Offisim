import { MOTION_DURATION, MOTION_EASING } from '@offisim/ui-core/tokens';
// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { isEmployeeBlocked } from '../../runtime/use-active-employee-count.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { SceneMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import type { DragState3D, FlowLineData } from './office3d-shared.js';
import { SCENE_LAYER_Y, getZoneBorderOpacity, getZoneRugOpacity } from './scene-art-direction.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const intersectPoint = new THREE.Vector3();

const COMPACT_ZONE_LABELS: Record<string, string> = {
  'ART & DESIGN': 'ART',
  DEVELOPMENT: 'DEV',
  'MEETING ROOM': 'MEET',
  'PRODUCT HUB': 'PRODUCT',
  'REST AREA': 'REST',
  'SERVER CLOSET': 'SERVER',
  'SERVER ROOM': 'SERVER',
};

function getZoneLabel(name: string) {
  const normalized = name.trim().toUpperCase();
  if (COMPACT_ZONE_LABELS[normalized]) return COMPACT_ZONE_LABELS[normalized];
  if (normalized.length <= 10) return normalized;
  return normalized.split(/\s+/)[0]?.slice(0, 10) ?? normalized.slice(0, 10);
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
  const sc = useSceneColors();
  const displayName = getZoneLabel(name);
  const floorOpacity = getZoneRugOpacity({
    isDragging: Boolean(isDragging),
    isHovered: Boolean(isHovered),
    isSource: Boolean(isSource),
    activityCount: activityCount ?? 0,
  });
  const borderOpacity = getZoneBorderOpacity({
    isDragging: Boolean(isDragging),
    isHovered: Boolean(isHovered),
    isSource: Boolean(isSource),
  });

  const edgePlaneGeo = useMemo(() => new THREE.PlaneGeometry(size[0], size[1]), [size[0], size[1]]);
  useEffect(() => () => edgePlaneGeo.dispose(), [edgePlaneGeo]);

  return (
    <group position={position}>
      <mesh position={[0, SCENE_LAYER_Y.zoneRug, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[Math.max(0.8, size[0] - 0.35), Math.max(0.8, size[1] - 0.35)]} />
        <SceneMaterial
          materialClass="fabric"
          color={color}
          overrides={{ transparent: true, opacity: floorOpacity, roughness: 0.92 }}
        />
      </mesh>
      <mesh position={[0, SCENE_LAYER_Y.zoneBorder, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={size} />
        <meshBasicMaterial color={sc.zoneRug} transparent opacity={0.05} />
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
        <Html position={[0, 0.8, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: isHovered ? color : sc.zoneLabelBg,
              backdropFilter: 'blur(4px)',
              border: `1px solid ${isHovered ? color : `${color}66`}`,
              borderRadius: '8px',
              padding: '4px 14px',
              whiteSpace: 'nowrap',
              transition: `background ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}, border-color ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
            }}
          >
            <span
              style={{
                color: isHovered ? sc.sceneBackground : color,
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
      <Html position={[0, 0.5, -size[1] / 2 + 0.5]} center style={{ pointerEvents: 'none' }}>
        <div
          data-zone-label={name}
          style={{
            background: sc.zoneLabelBg,
            backdropFilter: 'blur(8px)',
            border: `1px solid ${color}66`,
            borderRadius: '8px',
            maxWidth: '128px',
            overflow: 'hidden',
            padding: '4px 12px',
            boxShadow: `0 10px 28px ${sc.wallShadow}80, 0 0 16px ${sc.labelGlow}22`,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              color: sc.zoneLabelText,
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: 0,
              textTransform: 'uppercase',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            {displayName}
          </span>
        </div>
      </Html>
    </group>
  );
}

export function DragGhost3D({ position }: { position: [number, number, number] }) {
  const sc = useSceneColors();
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color={sc.sceneBackground} transparent opacity={0.25} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.3, 1.2, 12]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.selectionRing}
          overrides={{ transparent: true, opacity: 0.45 }}
        />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.22, 12, 12]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.selectionRing}
          overrides={{ transparent: true, opacity: 0.45 }}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color={sc.selectionRing} transparent opacity={0.6} />
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

export function AmbientStateLight({
  agents,
  maxIntensity,
}: {
  agents: Map<string, AgentState>;
  maxIntensity?: number;
}) {
  const scene = useThree((state) => state.scene);

  const { targetColor, targetIntensity } = useMemo(() => {
    const values = [...agents.values()];
    const hasBlocked = values.some((agent) => isEmployeeBlocked(agent.state));
    const hasActive = values.some((agent) => agent.state !== 'idle');
    const hasMeeting = values.some((agent) => agent.state === 'meeting');
    const color = hasBlocked
      ? '#ff9944'
      : hasMeeting
        ? '#c4bfee'
        : hasActive
          ? '#ffffff'
          : '#aabbcc';
    const rawIntensity = hasMeeting ? 0.6 : 0.8;
    return {
      targetColor: color,
      targetIntensity:
        maxIntensity === undefined ? rawIntensity : Math.min(rawIntensity, maxIntensity),
    };
  }, [agents, maxIntensity]);

  const targetColorObject = useMemo(() => new THREE.Color(targetColor), [targetColor]);
  const currentColorRef = useRef(new THREE.Color(targetColor));
  const currentIntensityRef = useRef(targetIntensity);

  useFrame(() => {
    currentColorRef.current.lerp(targetColorObject, 0.02);
    currentIntensityRef.current = THREE.MathUtils.lerp(
      currentIntensityRef.current,
      targetIntensity,
      0.02,
    );
    scene.userData.ambientStateColor = currentColorRef.current.clone();
    scene.userData.ambientStateIntensity = Math.min(
      maxIntensity ?? 0.25,
      currentIntensityRef.current,
    );
  });

  return null;
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
            letterSpacing: 0,
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
