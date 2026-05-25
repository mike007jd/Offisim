import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Input } from '@/design-system/primitives/input.js';
import { type EmployeeAppearance, employeeAvatarUri } from '@/lib/avatar.js';
import { cn } from '@/lib/utils.js';
import { Dices, Lock, User } from 'lucide-react';
import { useId } from 'react';
import {
  ACCENT_SWATCHES,
  type AppearanceDraft,
  BODY_TYPE_OPTIONS,
  CLOTHING_SWATCHES,
  DICEBEAR_STYLES,
  type DicebearStyle,
  GENDER_OPTIONS,
  HAIR_STYLE_OPTIONS,
  HAIR_SWATCHES,
  SKIN_SWATCHES,
  type SwatchOption,
} from './personnel-data.js';

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
              style={{ background: swatch.value }}
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
  return (
    <div className="off-pers-prev">
      <span className="off-pers-prev-label">{label}</span>
      {label.startsWith('3D') ? (
        <span className="off-pers-prev-figure">
          <Icon icon={User} size="md" />
        </span>
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
  const seed = draft.seedOverride?.trim() || employee.id;
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

            <CapsLabel className="mt-[var(--off-sp-2)]">Avatar style</CapsLabel>
            <div className="off-pers-style-grid">
              {DICEBEAR_STYLES.map((style) => {
                const selected = (draft.dicebearStyle ?? 'avataaars') === style.value;
                return (
                  <button
                    key={style.value}
                    type="button"
                    aria-pressed={selected}
                    className={cn('off-pers-style-cell off-focusable', selected && 'is-on')}
                    onClick={() =>
                      onChange({ ...draft, dicebearStyle: style.value as DicebearStyle })
                    }
                  >
                    <span
                      className="off-pers-style-av"
                      style={{
                        backgroundImage: `url(${employeeAvatarUri(`${seed}:${style.value}`, previewAppearance)})`,
                      }}
                    />
                    <span>{style.label}</span>
                  </button>
                );
              })}
            </div>

            <CapsLabel className="mt-[var(--off-sp-2)]">Seed override</CapsLabel>
            <div className="off-pers-seed-row">
              <Input
                className="font-mono text-[var(--off-fs-meta)]"
                value={draft.seedOverride ?? ''}
                onChange={(e) => onChange({ ...draft, seedOverride: e.target.value })}
              />
              <button
                type="button"
                title="Randomize seed"
                aria-label="Randomize seed"
                className="off-pers-dice off-focusable"
                onClick={() =>
                  onChange({ ...draft, seedOverride: Math.random().toString(36).slice(2, 10) })
                }
              >
                <Icon icon={Dices} size="sm" />
              </button>
            </div>
            <p className="off-field-hint">
              Seed feeds both the DiceBear hash and the procedural color resolvers.
            </p>
          </div>

          <div className="off-pers-prev-col">
            <PreviewCard
              label={`2D · ${draft.dicebearStyle ?? 'avataaars'}`}
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
