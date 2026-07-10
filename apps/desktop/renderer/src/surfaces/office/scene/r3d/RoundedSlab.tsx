import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';

function roundedRectangleShape(width: number, depth: number, radius: number) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const r = Math.min(radius, halfW, halfD);
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + r, -halfD);
  shape.lineTo(halfW - r, -halfD);
  shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + r);
  shape.lineTo(halfW, halfD - r);
  shape.quadraticCurveTo(halfW, halfD, halfW - r, halfD);
  shape.lineTo(-halfW + r, halfD);
  shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - r);
  shape.lineTo(-halfW, -halfD + r);
  shape.quadraticCurveTo(-halfW, -halfD, -halfW + r, -halfD);
  shape.closePath();
  return shape;
}

/** Builds a target-sized rounded slab. Bevel size is removed from the core
 * outline/depth before extrusion, so Three's outward bevel cannot inflate the
 * requested X/Y/Z envelope (unlike drei RoundedBox on a very thin box). */
export function createRoundedSlabGeometry(
  width: number,
  depth: number,
  height: number,
  cornerRadius: number,
  requestedBevel: number,
) {
  const bevelSize = Math.min(requestedBevel, width / 8, depth / 8, height * 0.42);
  const bevelThickness = Math.min(bevelSize, height * 0.2);
  const coreWidth = width - bevelSize * 2;
  const coreDepth = depth - bevelSize * 2;
  const coreHeight = height - bevelThickness * 2;
  const coreRadius = Math.max(0.001, cornerRadius - bevelSize);
  const geometry = new THREE.ExtrudeGeometry(
    roundedRectangleShape(coreWidth, coreDepth, coreRadius),
    {
      depth: coreHeight,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize,
      bevelThickness,
      curveSegments: 5,
      steps: 1,
    },
  );
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function RoundedSlab({
  width,
  depth,
  height,
  cornerRadius,
  bevelSize,
  position,
  castShadow = false,
  receiveShadow = false,
  children,
}: {
  width: number;
  depth: number;
  height: number;
  cornerRadius: number;
  bevelSize: number;
  position: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  children: ReactNode;
}) {
  const geometry = useMemo(
    () => createRoundedSlabGeometry(width, depth, height, cornerRadius, bevelSize),
    [bevelSize, cornerRadius, depth, height, width],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={position}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      {children}
    </mesh>
  );
}
