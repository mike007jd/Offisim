import { Html } from '@react-three/drei';
import { type RootState, useFrame, useThree } from '@react-three/fiber';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type Group,
  type Material,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

type AnnotationPriority = 'ambient' | 'actor' | 'critical';

type SceneAnnotationProps = {
  position: readonly [number, number, number];
  children: ReactNode;
  priority?: AnnotationPriority;
  align?: 'center' | 'start';
  interactive?: boolean;
  exclude?: RefObject<Object3D | null>;
};

type AnnotationSampler = (state: RootState, sampleOcclusion: boolean) => void;

type AnnotationRegistry = {
  nextId: number;
  cursor: number;
  samplers: Map<number, AnnotationSampler>;
};

const ANNOTATION_PROFILE = {
  ambient: { fullOpacityDistance: 28, fadeDistance: 62, minOpacity: 0, minScale: 0.8 },
  actor: { fullOpacityDistance: 36, fadeDistance: 80, minOpacity: 0.42, minScale: 0.84 },
  critical: { fullOpacityDistance: 48, fadeDistance: 96, minOpacity: 0.72, minScale: 0.9 },
} as const satisfies Record<
  AnnotationPriority,
  {
    fullOpacityDistance: number;
    fadeDistance: number;
    minOpacity: number;
    minScale: number;
  }
>;

const ANNOTATION_Z_INDEX = {
  ambient: [4, 2],
  actor: [8, 5],
  critical: [12, 9],
} as const satisfies Record<AnnotationPriority, readonly [number, number]>;

const OCCLUSION_BUDGET_PER_FRAME = 4;
const OCCLUSION_EPSILON = 0.12;
const ANNOTATION_REGISTRIES = new WeakMap<object, AnnotationRegistry>();

function annotationRegistry(renderer: object): AnnotationRegistry {
  const existing = ANNOTATION_REGISTRIES.get(renderer);
  if (existing) return existing;
  const created: AnnotationRegistry = { nextId: 1, cursor: 0, samplers: new Map() };
  ANNOTATION_REGISTRIES.set(renderer, created);
  return created;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function belongsTo(object: Object3D, root: Object3D | null): boolean {
  if (!root) return false;
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

function objectHierarchyIsVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible || current.userData.sceneAnnotationOccluder === false) return false;
  }
  return true;
}

function materialCanOcclude(material: Material | Material[] | undefined): boolean {
  if (!material) return false;
  const materials = Array.isArray(material) ? material : [material];
  return materials.some(
    (entry) =>
      entry.visible && entry.depthWrite && (!entry.transparent || entry.opacity >= 0.24),
  );
}

function objectCanOcclude(object: Object3D): boolean {
  if (!('isMesh' in object) || object.isMesh !== true || !objectHierarchyIsVisible(object)) {
    return false;
  }
  const material = 'material' in object ? (object.material as Material | Material[] | undefined) : undefined;
  return materialCanOcclude(material);
}

/** One frame hook per Canvas, with a bounded and staggered occlusion budget. */
export function SceneAnnotationScheduler() {
  const renderer = useThree((state) => state.gl);
  const registry = annotationRegistry(renderer);

  useFrame((state) => {
    const entries = [...registry.samplers.entries()];
    if (entries.length === 0) return;

    const sampleIds = new Set<number>();
    const sampleCount = Math.min(OCCLUSION_BUDGET_PER_FRAME, entries.length);
    for (let offset = 0; offset < sampleCount; offset += 1) {
      sampleIds.add(entries[(registry.cursor + offset) % entries.length]?.[0] ?? -1);
    }
    registry.cursor = (registry.cursor + sampleCount) % entries.length;

    for (const [id, sample] of entries) sample(state, sampleIds.has(id));
  }, -50);

  return null;
}

/**
 * Camera-safe screen-space annotation for the Office scene.
 *
 * Labels keep a bounded readable size, fade by semantic priority and respect
 * scene depth. Transparent pointer hitboxes are ignored, and callers can
 * exclude their own render group so a character never hides its own name.
 */
export function SceneAnnotation({
  position,
  children,
  priority = 'ambient',
  align = 'center',
  interactive = false,
  exclude,
}: SceneAnnotationProps) {
  const renderer = useThree((state) => state.gl);
  const registry = annotationRegistry(renderer);
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<Group>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const occludedRef = useRef(true);
  const hasOcclusionSampleRef = useRef(false);
  const lastOpacityRef = useRef<number | null>(null);
  const lastScaleRef = useRef<number | null>(null);
  const lastVisibleRef = useRef(false);
  const worldPositionRef = useRef(new Vector3());
  const projectedRef = useRef(new Vector3());
  const pointerRef = useRef(new Vector2());
  const raycasterRef = useRef(new Raycaster());
  const profile = ANNOTATION_PROFILE[priority];

  useEffect(() => {
    const id = registry.nextId;
    registry.nextId += 1;

    const sample: AnnotationSampler = ({ camera, scene }, sampleOcclusion) => {
      const anchor = anchorRef.current;
      const content = contentRef.current;
      if (!anchor || !content) return;

      const worldPosition = anchor.getWorldPosition(worldPositionRef.current);
      const distance = camera.position.distanceTo(worldPosition);
      const fadeProgress = clamp01(
        (distance - profile.fullOpacityDistance) /
          Math.max(1, profile.fadeDistance - profile.fullOpacityDistance),
      );
      const opacity = Math.max(profile.minOpacity, 1 - fadeProgress);
      const scale = 1 - fadeProgress * (1 - profile.minScale);

      if (sampleOcclusion) {
        const projected = projectedRef.current.copy(worldPosition).project(camera);
        const offscreen =
          projected.z < -1 ||
          projected.z > 1 ||
          projected.x < -1.08 ||
          projected.x > 1.08 ||
          projected.y < -1.08 ||
          projected.y > 1.08;

        if (offscreen) {
          occludedRef.current = true;
        } else {
          pointerRef.current.set(projected.x, projected.y);
          const raycaster = raycasterRef.current;
          raycaster.setFromCamera(pointerRef.current, camera);
          const excludedRoot = exclude?.current ?? null;
          const anchorDistance = raycaster.ray.origin.distanceTo(worldPosition);
          raycaster.far = Math.max(0, anchorDistance - OCCLUSION_EPSILON);
          raycaster.layers.mask = camera.layers.mask;
          const blocker = raycaster
            .intersectObjects(scene.children, true)
            .find(
              (hit) =>
                !belongsTo(hit.object, anchor) &&
                !belongsTo(hit.object, excludedRoot) &&
                objectCanOcclude(hit.object),
            );
          occludedRef.current = blocker !== undefined;
        }
        hasOcclusionSampleRef.current = true;
      }

      const visible = hasOcclusionSampleRef.current && !occludedRef.current && opacity > 0.02;
      if (lastVisibleRef.current !== visible) {
        lastVisibleRef.current = visible;
        setVisible(visible);
      }
      if (lastOpacityRef.current === null || Math.abs(lastOpacityRef.current - opacity) > 0.005) {
        lastOpacityRef.current = opacity;
        content.style.opacity = opacity.toFixed(3);
      }
      if (lastScaleRef.current === null || Math.abs(lastScaleRef.current - scale) > 0.005) {
        lastScaleRef.current = scale;
        content.style.transform = `scale(${scale.toFixed(3)})`;
      }
    };

    registry.samplers.set(id, sample);
    return () => {
      registry.samplers.delete(id);
    };
  }, [exclude, profile, registry]);

  return (
    <group ref={anchorRef} position={[position[0], position[1], position[2]]}>
      <Html
        key={priority}
        center={align === 'center'}
        zIndexRange={[...ANNOTATION_Z_INDEX[priority]]}
        className="off-scene-html-passive"
      >
        <div
          ref={contentRef}
          hidden={!visible}
          inert={!visible}
          aria-hidden={!visible}
          className={`off-scene-annotation is-${priority} is-${align}${
            interactive ? ' is-interactive' : ''
          }${visible ? ' is-visible' : ''}`}
          data-scene-annotation={priority}
        >
          {children}
        </div>
      </Html>
    </group>
  );
}
