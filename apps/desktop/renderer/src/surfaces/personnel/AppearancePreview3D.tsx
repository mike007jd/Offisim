import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import type { ResolvedAppearance } from '@/lib/avatar.js';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { GltfCharacter } from '../office/scene/character/GltfCharacter.js';

interface AppearancePreview3DProps {
  appearance: ResolvedAppearance;
  role: string;
  compact?: boolean;
}

export function AppearancePreview3D({
  appearance,
  role,
  compact = false,
}: AppearancePreview3DProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scale = compact ? 1.12 : 1.28;

  return (
    <Canvas camera={{ position: [0, 1.4, 5.6], fov: 34 }} dpr={[1, 2]}>
      <ambientLight intensity={0.84} />
      <directionalLight position={[2, 4, 3]} intensity={1.75} />
      <group position={[0, -0.9, 0]} rotation={[0, -0.26, 0]} scale={scale}>
        <Suspense fallback={null}>
          <GltfCharacter
            appearance={appearance}
            status="idle"
            selected
            role={role}
            phase={0}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      </group>
      <OrbitControls
        enablePan={false}
        minDistance={3.2}
        maxDistance={6.8}
        minPolarAngle={0.62}
        maxPolarAngle={1.42}
      />
    </Canvas>
  );
}
