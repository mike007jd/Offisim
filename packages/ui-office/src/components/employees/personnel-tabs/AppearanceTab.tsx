import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import * as THREE from 'three';
import type { UseEmployeeEditorReturn } from '../../../hooks/useEmployeeEditor';
import {
  resolveAccentColor,
  resolveHairColor,
  resolveOutfitColor,
  resolveSkinTone,
} from '../../../lib/avatar-seed';
import { type BrandVariant, lookupExternalBrand } from '../../../lib/brand-registry';
import { SceneMaterial } from '../../../theme/scene-materials';
import { useSceneColors } from '../../../theme/use-scene-colors';
import {
  resolveBlockBodyType,
  resolveBlockGender,
  resolveBlockHairStyle,
} from '../../scene/character-mesh-builder';
import {
  CodexBody,
  CustomBody,
  DefaultBlockBody,
  HermesBody,
  OpenClawBody,
} from '../../scene/office3d-brand-variants';
import { BrandAvatar2D } from '../../shared/BrandAvatar2D';
import { DicebearAvatar } from '../../shared/DicebearAvatar';
import { AvatarCustomizer } from '../AvatarCustomizer';
import { TabSelectionEmpty } from './shared';

interface AppearanceTabProps {
  editor: UseEmployeeEditorReturn;
}

export function AppearanceTab({ editor }: AppearanceTabProps) {
  if (editor.employeeId === null) {
    return <TabSelectionEmpty message="Select an employee on the left to customize appearance." />;
  }

  const { formData, updateField } = editor;
  const isExternal = formData.isExternal;

  return (
    <div
      data-personnel-tab-scroll
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-6"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-appearance-tab">
        <div className="min-w-0">
          {isExternal ? (
            <p data-testid="external-avatar-disabled" className="text-fs-meta text-ink-4">
              Brand avatar — appearance is fixed.
            </p>
          ) : (
            <AvatarCustomizer
              config={formData.appearance}
              onChange={(cfg) => updateField('appearance', cfg)}
            />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <PreviewCard label="2D">
            {isExternal ? (
              <BrandAvatar2D brandKey={formData.brandKey} size={140} />
            ) : (
              <DicebearAvatar
                seed={formData.name || 'preview'}
                size={140}
                appearance={formData.appearance}
              />
            )}
          </PreviewCard>
          <PreviewCard label="3D">
            <Preview3DCanvas
              isExternal={isExternal}
              brandKey={formData.brandKey}
              appearance={isExternal ? null : formData.appearance}
              seed={formData.name || 'preview'}
              outfitColor={resolveOutfitColor(
                formData.name || 'preview',
                isExternal ? null : formData.appearance,
              )}
              skinTone={resolveSkinTone(
                formData.name || 'preview',
                isExternal ? null : formData.appearance,
              )}
            />
          </PreviewCard>
        </div>
      </div>
    </div>
  );
}

function PreviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative flex avatar-preview-card w-full items-center justify-center rounded-r-md border border-line-soft bg-surface-2">
      <span className="absolute left-2 top-1.5 text-fs-meta font-medium uppercase tracking-wider text-ink-4">
        {label}
      </span>
      {children}
    </div>
  );
}

function Preview3DCanvas({
  isExternal,
  brandKey,
  seed,
  appearance,
  outfitColor,
  skinTone,
}: {
  isExternal: boolean;
  brandKey: string | null;
  seed: string;
  appearance: UseEmployeeEditorReturn['formData']['appearance'] | null;
  outfitColor: string;
  skinTone: string;
}) {
  const variant: BrandVariant = isExternal
    ? lookupExternalBrand(brandKey).asset3dVariant
    : 'default';
  const sc = useSceneColors();
  const canvasStyle = { ['background']: 'transparent' };
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: [0, 1.5, 3], fov: 35 }}
      // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
      style={canvasStyle}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[3, 5, 4]}
          intensity={0.9}
          castShadow
          shadow-mapSize={[512, 512]}
        />
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[6, 6]} />
          <SceneMaterial
            materialClass="plastic"
            color={sc.floorTile}
            overrides={{ roughness: 1 }}
          />
        </mesh>
        <PreviewFigure
          variant={variant}
          outfitColor={outfitColor}
          skinTone={skinTone}
          hairColor={resolveHairColor(seed, appearance)}
          accentColor={resolveAccentColor(seed, appearance)}
          bodyType={resolveBlockBodyType(appearance?.bodyType)}
          gender={resolveBlockGender(appearance?.gender)}
          hairStyle={resolveBlockHairStyle(appearance?.hairStyle)}
        />
        <OrbitControls enableZoom={false} target={[0, 0.9, 0]} />
      </Suspense>
    </Canvas>
  );
}

function PreviewFigure({
  variant,
  outfitColor,
  skinTone,
  hairColor,
  accentColor,
  bodyType,
  gender,
  hairStyle,
}: {
  variant: BrandVariant;
  outfitColor: string;
  skinTone: string;
  hairColor: string;
  accentColor: string;
  bodyType: 'slim' | 'normal' | 'stocky';
  gender: 'masculine' | 'feminine' | 'neutral';
  hairStyle: 'short' | 'long' | 'ponytail' | 'curly' | 'bald' | 'bob' | 'spiky' | 'braids';
}) {
  if (variant === 'default') {
    return (
      <DefaultBlockBody
        params={{
          skinColor: skinTone,
          hairColor,
          outfitColor,
          accentColor,
          bodyType,
          gender,
          hairStyle,
          state: 'idle',
          isBlocked: false,
          accentVariant: 'vest',
        }}
      />
    );
  }
  if (variant === 'hermes') return <HermesBody />;
  if (variant === 'openclaw') return <OpenClawBody />;
  if (variant === 'codex') return <CodexBody />;
  return <CustomBody />;
}
