import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function useProceduralRoomEnvironment(active: boolean): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    if (!active) return;

    const env = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(env, 0.04).texture;
    scene.environment = tex;

    return () => {
      tex.dispose();
      pmrem.dispose();
      env.dispose();
      if (scene.environment === tex) {
        scene.environment = null;
      }
    };
  }, [active, gl, scene]);
}
