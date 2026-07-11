import { useFrame } from '@react-three/fiber';
import { memo } from 'react';
import { useRef } from 'react';
import { BackSide, Color, type Mesh } from 'three';
import { SCENE_ENV_COLORS } from './scene-colors.js';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  varying vec3 vDirection;
  void main() {
    float upper = smoothstep(-0.05, 0.72, vDirection.y);
    float lower = smoothstep(-0.82, -0.08, vDirection.y);
    vec3 lowerMix = mix(bottomColor, horizonColor, lower);
    vec3 color = mix(lowerMix, topColor, upper);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const DIORAMA_BACKDROP_RADIUS = 150;

/** Camera-surrounding studio gradient. A closed backdrop keeps every legal
 * orbit angle intentional without reintroducing walls or fetching an HDRI. */
const BACKDROP_UNIFORMS = {
  topColor: { value: new Color(SCENE_ENV_COLORS.backdropTop) },
  horizonColor: { value: new Color(SCENE_ENV_COLORS.backdropHorizon) },
  bottomColor: { value: new Color(SCENE_ENV_COLORS.backdropBottom) },
};

export const DioramaBackdrop = memo(function DioramaBackdrop() {
  const backdropRef = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    backdropRef.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={backdropRef} renderOrder={-1000} scale={DIORAMA_BACKDROP_RADIUS}>
      <sphereGeometry args={[1, 40, 24]} />
      <shaderMaterial
        uniforms={BACKDROP_UNIFORMS}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
});
