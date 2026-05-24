import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import type { CSSProperties } from 'react';
import type { AvatarAppearance } from '../../hooks/useEmployeeEditor';
import { OUTFIT_COLORS_NUMERIC, OUTFIT_LABELS, numericToHex } from '../../lib/avatar-seed';

interface AvatarCustomizerProps {
  config: AvatarAppearance;
  onChange: (config: AvatarAppearance) => void;
}

// Manual-config palettes, independent from seed-derived SKIN_TONES in avatar-seed.ts.
const SKIN_COLORS: { value: number; label: string }[] = [
  { value: 0xfde8d5, label: 'Light' },
  { value: 0xfdbcb4, label: 'Fair' },
  { value: 0xe8a87c, label: 'Medium' },
  { value: 0xb07650, label: 'Tan' },
  { value: 0x6b3f2a, label: 'Dark' },
];

const HAIR_COLORS: { value: number; label: string }[] = [
  { value: 0x1a1a1a, label: 'Black' },
  { value: 0x6b3f1e, label: 'Brown' },
  { value: 0xd4a843, label: 'Blonde' },
  { value: 0xb03020, label: 'Red' },
  { value: 0x9e9e9e, label: 'Gray' },
  { value: 0x3d6bce, label: 'Blue' },
];

// Clothing swatches derive from OUTFIT_COLORS (avatar-seed.ts SSOT) so that
// manual-config, 2D DiceBear shirt and 3D block-figure body all share the same palette.
const CLOTHING_COLORS: { value: number; label: string }[] = OUTFIT_COLORS_NUMERIC.map(
  (value, i) => ({ value, label: OUTFIT_LABELS[i] ?? `Color ${i + 1}` }),
);

const HAIR_STYLES = [
  'short',
  'long',
  'ponytail',
  'curly',
  'bald',
  'bob',
  'spiky',
  'braids',
] as const;

const BODY_TYPES = ['normal', 'slim', 'stocky'] as const;

const GENDER_OPTIONS = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'masculine', label: 'Masc' },
  { value: 'feminine', label: 'Fem' },
] as const;

interface SwatchRowProps {
  label: string;
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
}

function SwatchRow({ label, options, selected, onSelect }: SwatchRowProps) {
  return (
    <div className="avatar-customizer-swatch-row">
      <p>{label}</p>
      <div>
        {options.map((opt) => {
          const selectedStyle = selected === opt.value;
          const swatchStyle = {
            '--avatar-swatch-color': numericToHex(opt.value),
          } as CSSProperties;
          return (
            <Button
              key={opt.value}
              type="button"
              title={opt.label}
              variant="ghost"
              size="icon"
              onClick={() => onSelect(opt.value)}
              className="avatar-customizer-swatch"
              data-selected={selectedStyle ? 'true' : 'false'}
              // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
              style={swatchStyle}
            />
          );
        })}
      </div>
    </div>
  );
}

export function AvatarCustomizer({ config, onChange }: AvatarCustomizerProps) {
  const set = <K extends keyof AvatarAppearance>(key: K, value: AvatarAppearance[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="avatar-customizer">
      <p className="avatar-customizer-title">Appearance</p>

      <SwatchRow
        label="Skin tone"
        options={SKIN_COLORS}
        selected={config.skinColor}
        onSelect={(v) => set('skinColor', v)}
      />

      <SwatchRow
        label="Hair color"
        options={HAIR_COLORS}
        selected={config.hairColor}
        onSelect={(v) => set('hairColor', v)}
      />

      <SwatchRow
        label="Clothing color"
        options={CLOTHING_COLORS}
        selected={config.clothingColor}
        onSelect={(v) => set('clothingColor', v)}
      />

      <div>
        <SwatchRow
          label="Clothing accent"
          options={CLOTHING_COLORS}
          selected={config.clothingAccent}
          onSelect={(v) => set('clothingAccent', v)}
        />
        <p className="avatar-customizer-hint">Renders as a visible vest panel.</p>
      </div>

      {/* Gender presentation toggle */}
      <div className="avatar-customizer-field">
        <p>Gender presentation</p>
        <div className="avatar-customizer-toggle">
          {GENDER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set('gender', opt.value)}
              className="avatar-customizer-toggle-item"
              data-selected={config.gender === opt.value ? 'true' : 'false'}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="avatar-customizer-select-grid">
        <div className="avatar-customizer-field">
          <p>Hair style</p>
          <Select value={config.hairStyle} onValueChange={(v) => set('hairStyle', v)}>
            <SelectTrigger className="avatar-customizer-select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HAIR_STYLES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="avatar-customizer-field">
          <p>Body type</p>
          <Select value={config.bodyType} onValueChange={(v) => set('bodyType', v)}>
            <SelectTrigger className="avatar-customizer-select-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BODY_TYPES.map((b) => (
                <SelectItem key={b} value={b}>
                  {b.charAt(0).toUpperCase() + b.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
