import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useState } from 'react';
import * as THREE from 'three';

const DEFAULT_CHARACTER_LOD_THRESHOLD = 20;

export function useCharacterLod(
  worldPos: [number, number, number],
  threshold = DEFAULT_CHARACTER_LOD_THRESHOLD,
): { isFar: boolean } {
  const camera = useThree((state) => state.camera);
  const positionRef = useRef(new THREE.Vector3(...worldPos));
  const isFarRef = useRef(true);
  const [isFar, setIsFar] = useState(true);

  useFrame(() => {
    positionRef.current.set(worldPos[0], worldPos[1], worldPos[2]);
    const nextIsFar = camera.position.distanceTo(positionRef.current) > threshold;
    if (nextIsFar === isFarRef.current) return;
    isFarRef.current = nextIsFar;
    setIsFar(nextIsFar);
  });

  return { isFar };
}
