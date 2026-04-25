import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import type { UseEmployeeEditorReturn } from '../../../hooks/useEmployeeEditor';
import { lookupExternalBrand, type BrandVariant } from '../../../lib/brand-registry';
import { resolveOutfitColor, resolveSkinTone } from '../../../lib/avatar-seed';
import { AvatarCustomizer } from '../AvatarCustomizer';
import { BrandAvatar2D } from '../../shared/BrandAvatar2D';
import { DicebearAvatar } from '../../shared/DicebearAvatar';
import {
  CodexBody,
  CustomBody,
  DefaultBlockBody,
  HermesBody,
  OpenClawBody,
} from '../../scene/office3d-brand-variants';
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
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          {isExternal ? (
            <div
              data-testid="external-avatar-disabled"
              className="flex flex-col gap-1 rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-300">
                Appearance
              </p>
              <p className="text-xs text-slate-400">
                This employee uses its brand's built-in avatar and cannot be customized.
              </p>
            </div>
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="self-start text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div className="flex h-[200px] w-full items-center justify-center">{children}</div>
    </div>
  );
}

function Preview3DCanvas({
  isExternal,
  brandKey,
  outfitColor,
  skinTone,
}: {
  isExternal: boolean;
  brandKey: string | null;
  outfitColor: string;
  skinTone: string;
}) {
  const variant: BrandVariant = isExternal ? lookupExternalBrand(brandKey).asset3dVariant : 'default';
  return (
    <Canvas
      shadows
      camera={{ position: [0, 1.5, 3], fov: 35 }}
      style={{ width: 256, height: 200, background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={0.9} castShadow />
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[6, 6]} />
          <meshStandardMaterial color="#0f172a" roughness={1} />
        </mesh>
        <PreviewFigure variant={variant} outfitColor={outfitColor} skinTone={skinTone} />
        <OrbitControls enableZoom={false} target={[0, 0.9, 0]} />
      </Suspense>
    </Canvas>
  );
}

function PreviewFigure({
  variant,
  outfitColor,
  skinTone,
}: {
  variant: BrandVariant;
  outfitColor: string;
  skinTone: string;
}) {
  if (variant === 'default') {
    return <DefaultBlockBody outfitColor={outfitColor} skinTone={skinTone} />;
  }
  if (variant === 'hermes') return <HermesBody />;
  if (variant === 'openclaw') return <OpenClawBody />;
  if (variant === 'codex') return <CodexBody />;
  return <CustomBody />;
}
