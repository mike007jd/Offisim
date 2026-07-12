import type { Employee } from '@/data/types.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { type EmployeeAppearance, resolveAppearance } from '@/lib/avatar.js';
import { cn } from '@/lib/utils.js';
import { Lock } from 'lucide-react';
import { type CSSProperties, lazy, Suspense, useId } from 'react';
import {
  ACCENT_SWATCHES,
  type AppearanceDraft,
  BODY_TYPE_OPTIONS,
  CLOTHING_SWATCHES,
  GENDER_OPTIONS,
  HAIR_STYLE_OPTIONS,
  HAIR_SWATCHES,
  HEAD_SHAPE_OPTIONS,
  OUTFIT_OPTIONS,
  SKIN_SWATCHES,
  type SwatchOption,
} from './personnel-data.js';

const AppearancePreview3D = lazy(() =>
  import('./AppearancePreview3D.js').then((module) => ({ default: module.AppearancePreview3D })),
);

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
  const displayedSwatches =
    value && !swatches.some((swatch) => swatch.value.toLowerCase() === value.toLowerCase())
      ? [{ value, label: 'Current custom' }, ...swatches]
      : swatches;
  return (
    <div className="off-pers-swrow">
      <span className="off-pers-sw-label">{label}</span>
      <div className="off-pers-sws">
        {displayedSwatches.map((swatch) => {
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

function AppearancePreviewPanel({
  appearance,
  seed,
  role,
  colorA,
  colorB,
  brand = false,
  compact = false,
}: {
  appearance: EmployeeAppearance;
  seed: string;
  role: string;
  colorA: string;
  colorB: string;
  brand?: boolean;
  compact?: boolean;
}) {
  const resolved = resolveAppearance(seed, appearance);

  return (
    <div className={cn('off-pers-prev is-3d-main', compact && 'is-compact')}>
      <span className="off-pers-prev-label">3D</span>
      <div className="off-pers-prev-canvas" aria-label="3D avatar preview">
        <Suspense fallback={<div className="off-pers-prev-loading">Loading 3D…</div>}>
          <AppearancePreview3D appearance={resolved} role={role} compact={compact} />
        </Suspense>
      </div>
      <div className="off-pers-prev-2d" aria-label="2D avatar reference">
        <EmployeeAvatar
          seed={seed}
          appearance={appearance}
          colorA={colorA}
          colorB={colorB}
          size={44}
          brand={brand}
        />
        <span>2D</span>
      </div>
    </div>
  );
}

export function CompactAppearanceEditor({
  seed,
  role,
  draft,
  onChange,
}: {
  seed: string;
  role: string;
  draft: AppearanceDraft;
  onChange: (next: AppearanceDraft) => void;
}) {
  const hairStyleId = useId();
  return (
    <section className="off-pers-hire-appearance" aria-label="Employee appearance">
      <div className="off-pers-hire-appearance-head">
        <span>Appearance</span>
        <small>Randomized for this hire · editable now</small>
      </div>
      <div className="off-pers-hire-appearance-grid">
        <AppearancePreviewPanel
          appearance={draft}
          seed={seed}
          role={role}
          colorA={UI_DATA_COLORS.blue}
          colorB={UI_DATA_COLORS.violet}
          compact
        />
        <div className="off-pers-hire-appearance-controls">
          <div className="off-field">
            <label className="off-field-label" htmlFor={hairStyleId}>
              Hair style
            </label>
            <Select
              id={hairStyleId}
              value={draft.hairStyle ?? 'short'}
              onChange={(event) =>
                onChange({
                  ...draft,
                  hairStyle: event.target.value as AppearanceDraft['hairStyle'],
                })
              }
              options={HAIR_STYLE_OPTIONS}
            />
          </div>
          <SwatchRow
            label="Hair color"
            swatches={HAIR_SWATCHES}
            value={draft.hairColor}
            onChange={(hairColor) => onChange({ ...draft, hairColor })}
          />
          <SwatchRow
            label="Skin tone"
            swatches={SKIN_SWATCHES}
            value={draft.skinColor}
            onChange={(skinColor) => onChange({ ...draft, skinColor })}
          />
          <SwatchRow
            label="Outfit color"
            swatches={CLOTHING_SWATCHES}
            value={draft.clothingColor}
            onChange={(clothingColor) => onChange({ ...draft, clothingColor })}
          />
        </div>
      </div>
    </section>
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
  const headShapeId = useId();
  const outfitId = useId();
  const seed = employee.id;
  const isExternal = employee.kind === 'external';

  const previewAppearance: EmployeeAppearance = {
    skinColor: draft.skinColor,
    hairColor: draft.hairColor,
    clothingColor: draft.clothingColor,
    accentColor: draft.accentColor,
    hairStyle: draft.hairStyle,
    bodyType: draft.bodyType,
    headShape: draft.headShape,
    gender: draft.gender,
    outfit: draft.outfit,
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
            <AppearancePreviewPanel
              appearance={previewAppearance}
              seed={seed}
              role={employee.roleSlug ?? employee.role}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
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
              hint="Tints the lower outfit."
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
              <div className="off-field">
                <label className="off-field-label" htmlFor={headShapeId}>
                  Head shape
                </label>
                <Select
                  id={headShapeId}
                  value={draft.headShape ?? 'round'}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      headShape: e.target.value as AppearanceDraft['headShape'],
                    })
                  }
                  options={HEAD_SHAPE_OPTIONS}
                />
              </div>
              <div className="off-field">
                <label className="off-field-label" htmlFor={outfitId}>
                  Outfit
                </label>
                <Select
                  id={outfitId}
                  value={draft.outfit ?? 'blazer'}
                  onChange={(e) =>
                    onChange({ ...draft, outfit: e.target.value as AppearanceDraft['outfit'] })
                  }
                  options={OUTFIT_OPTIONS}
                />
              </div>
            </div>

            <p className="off-field-hint">
              Appearance persists to the employee persona. Gender presentation affects the 2D
              reference only; the other controls drive the office 3D avatar.
            </p>
          </div>

          <div className="off-pers-prev-col">
            <AppearancePreviewPanel
              appearance={previewAppearance}
              seed={seed}
              role={employee.roleSlug ?? employee.role}
              colorA={employee.avatarA}
              colorB={employee.avatarB}
              brand={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
