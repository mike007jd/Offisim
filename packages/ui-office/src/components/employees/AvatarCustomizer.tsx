import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@offisim/ui-core';
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
    <div>
      <p className="mb-1.5 text-caption text-text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selectedStyle = selected === opt.value;
          const swatchStyle = {
            ['backgroundColor']: numericToHex(opt.value),
            ['borderColor']: selectedStyle ? 'var(--color-text-primary-val)' : 'transparent',
            ['boxShadow']: selectedStyle ? '0 0 0 1px var(--color-border-focus-val)' : 'none',
          };
          return (
            <Button
              key={opt.value}
              type="button"
              title={opt.label}
              variant="ghost"
              size="icon"
              onClick={() => onSelect(opt.value)}
              className="size-6 shrink-0 rounded-full border-2 p-0 transition-all"
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
    <div className="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-muted p-3">
      <p className="text-caption font-medium uppercase tracking-wider text-text-primary">
        Appearance
      </p>

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
        <p className="mt-1 text-caption text-text-muted">Renders as a visible vest panel.</p>
      </div>

      {/* Gender presentation toggle */}
      <div>
        <p className="mb-1.5 text-caption text-text-muted">Gender presentation</p>
        <div className="flex gap-1">
          {GENDER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set('gender', opt.value)}
              className={cn(
                'h-7 flex-1 rounded-none border py-1 text-caption',
                config.gender === opt.value
                  ? 'border-border-focus bg-accent-muted text-accent-text'
                  : 'border-border-default bg-surface text-text-secondary hover:border-border-strong',
              )}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="mb-1 text-caption text-text-muted">Hair style</p>
          <Select value={config.hairStyle} onValueChange={(v) => set('hairStyle', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HAIR_STYLES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs capitalize">
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="mb-1 text-caption text-text-muted">Body type</p>
          <Select value={config.bodyType} onValueChange={(v) => set('bodyType', v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BODY_TYPES.map((b) => (
                <SelectItem key={b} value={b} className="text-xs capitalize">
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
