import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { type EmployeeAppearance, resolveAppearance } from '@/lib/avatar.js';
import { cn } from '@/lib/utils.js';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Lock } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { BlockCharacter } from '../office/scene/BlockCharacter.js';
import {
  ACCENT_SWATCHES,
  type AppearanceDraft,
  BODY_TYPE_OPTIONS,
  CLOTHING_SWATCHES,
  GENDER_OPTIONS,
  HAIR_STYLE_OPTIONS,
  HAIR_SWATCHES,
  SKIN_SWATCHES,
  type SwatchOption,
} from './personnel-data.js';

function swatchStyle(value: string): CSSProperties {
  return { '--off-pers-swatch': value } as CSSProperties;
}

function SwatchRow({
  label,
  hint,
  swatches,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  swatches: SwatchOption[];
  value: string | undefined;
  onChange: (color: string) => void;
}) {
  return (
    <div className="off-pers-swrow">
      <span className="off-pers-sw-label">{label}</span>
      <div className="off-pers-sws">
        {swatches.map((swatch) => {
          const selected = (value ?? '').toLowerCase() === swatch.value.toLowerCase();
          return (
            <button
              key={swatch.value}
              type="button"
              aria-label={swatch.label}
              aria-pressed={selected}
              title={swatch.label}
              className={cn('off-pers-sw off-focusable', selected && 'is-on')}
              style={swatchStyle(swatch.value)}
              onClick={() => onChange(swatch.value)}
            />
          );
        })}
      </div>
      {hint ? <span className="off-pers-sw-hint">{hint}</span> : null}
    </div>
  );
}

function PreviewCard({
  label,
  employee,
  appearance,
  seed,
  brand,
}: {
  label: string;
  employee: Employee;
  appearance: EmployeeAppearance;
  seed: string;
  brand: boolean;
}) {
  const resolved = resolveAppearance(seed, appearance);
  return (
    <div className="off-pers-prev">
      <span className="off-pers-prev-label">{label}</span>
      {label.startsWith('3D') ? (
        <div className="off-pers-prev-canvas" aria-label="3D avatar preview">
          <Canvas camera={{ position: [0, 1.35, 3.2], fov: 36 }} dpr={[1, 2]}>
            <ambientLight intensity={0.8} />
            <directionalLight position={[2, 4, 3]} intensity={1.7} />
            <group position={[0, -0.62, 0]} rotation={[0, -0.28, 0]} scale={1.35}>
              <BlockCharacter appearance={resolved} running={false} phase={0} />
            </group>
            <OrbitControls
              enablePan={false}
              minDistance={2.4}
              maxDistance={4.4}
              minPolarAngle={0.7}
              maxPolarAngle={1.4}
            />
          </Canvas>
        </div>
      ) : (
        <EmployeeAvatar
          seed={seed}
          appearance={appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={88}
          brand={brand}
        />
      )}
    </div>
  );
}

interface AppearanceTabProps {
  employee: Employee;
  draft: AppearanceDraft;
  onChange: (next: AppearanceDraft) => void;
}

export function AppearanceTab({ employee, draft, onChange }: AppearanceTabProps) {
  const hairStyleId = useId();
  const bodyTypeId = useId();
  const seed = employee.id;
  const isExternal = employee.kind === 'external';

  const previewAppearance: EmployeeAppearance = {
    skinColor: draft.skinColor,
    hairColor: draft.hairColor,
    clothingColor: draft.clothingColor,
    accentColor: draft.accentColor,
    hairStyle: draft.hairStyle,
    bodyType: draft.bodyType,
    gender: draft.gender,
    accentVariant: draft.accentVariant,
  };

  if (isExternal) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <div className="off-pers-ro-notice">
            <Icon icon={Lock} size="sm" />
            Brand avatar — appearance is fixed.
          </div>
          <div className="off-pers-prev-col">
            <PreviewCard
              label="2D"
              employee={employee}
              appearance={previewAppearance}
              seed={seed}
              brand
            />
            <PreviewCard
              label="3D"
              employee={employee}
              appearance={previewAppearance}
              seed={seed}
              brand
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <div className="off-pers-app-grid">
          <div className="off-pers-avc">
            <CapsLabel>Appearance</CapsLabel>
            <SwatchRow
              label="Skin tone"
              swatches={SKIN_SWATCHES}
              value={draft.skinColor}
              onChange={(c) => onChange({ ...draft, skinColor: c })}
            />
            <SwatchRow
              label="Hair color"
              swatches={HAIR_SWATCHES}
              value={draft.hairColor}
              onChange={(c) => onChange({ ...draft, hairColor: c })}
            />
            <SwatchRow
              label="Clothing color"
              swatches={CLOTHING_SWATCHES}
              value={draft.clothingColor}
              onChange={(c) => onChange({ ...draft, clothingColor: c })}
            />
            <SwatchRow
              label="Clothing accent"
              hint="Renders as a visible vest panel."
              swatches={ACCENT_SWATCHES}
              value={draft.accentColor}
              onChange={(c) => onChange({ ...draft, accentColor: c })}
            />
            <div className="off-pers-swrow">
              <span className="off-pers-sw-label">Gender presentation</span>
              <SegmentedControl
                options={GENDER_OPTIONS}
                value={draft.gender ?? 'neutral'}
                onChange={(g) => onChange({ ...draft, gender: g })}
                ariaLabel="Gender presentation"
              />
            </div>
            <div className="off-pers-avc-2col">
              <div className="off-field">
                <label className="off-field-label" htmlFor={hairStyleId}>
                  Hair style
                </label>
                <Select
                  id={hairStyleId}
                  value={draft.hairStyle ?? 'short'}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      hairStyle: e.target.value as AppearanceDraft['hairStyle'],
                    })
                  }
                  options={HAIR_STYLE_OPTIONS}
                />
              </div>
              <div className="off-field">
                <label className="off-field-label" htmlFor={bodyTypeId}>
                  Body type
                </label>
                <Select
                  id={bodyTypeId}
                  value={draft.bodyType ?? 'normal'}
                  onChange={(e) =>
                    onChange({ ...draft, bodyType: e.target.value as AppearanceDraft['bodyType'] })
                  }
                  options={BODY_TYPE_OPTIONS}
                />
              </div>
            </div>

            <p className="off-field-hint">
              These controls persist to the employee persona and drive both the 2D avatar and the
              3D preview.
            </p>
          </div>

          <div className="off-pers-prev-col">
            <PreviewCard
              label="2D"
              employee={employee}
              appearance={previewAppearance}
              seed={seed}
              brand={false}
            />
            <PreviewCard
              label="3D"
              employee={employee}
              appearance={previewAppearance}
              seed={seed}
              brand={false}
            />
            <p className="off-field-hint text-center">
              Preview recomputes on every style / seed / color change.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
